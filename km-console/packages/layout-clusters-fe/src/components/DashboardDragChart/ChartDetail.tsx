import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppContainer, Button, Drawer, IconFont, message, Spin, Table, SingleChart, Utils, Tooltip } from 'knowdesign';
import moment from 'moment';
import api, { MetricType } from '@src/api';
import { useParams } from 'react-router-dom';
import { debounce } from 'lodash';
import { MetricDefaultChartDataType, MetricChartDataType, formatChartData, getDetailChartConfig } from './config';
import { UNIT_MAP } from '@src/constants/chartConfig';
import { CloseOutlined } from '@ant-design/icons';

interface ChartDetailProps {
  metricType: MetricType;
  metricName: string;
  queryLines: string[];
  onClose: () => void;
}

interface MetricTableInfo {
  name: string;
  avg: number;
  max: number;
  min: number;
  latest: (string | number)[];
  color: string;
}

interface DataZoomEventProps {
  type: 'datazoom';
  // 缩放的开始位置的百分比，0 - 100
  start: number;
  // 缩放的结束位置的百分比，0 - 100
  end: number;
}

// 缩放区默认选中范围比例（0.01～1）
const DATA_ZOOM_DEFAULT_SCALE = 0.25;
// 选中范围最少展示的时间长度（默认 10 分钟），单位: ms
const LEAST_SELECTED_TIME_RANGE = 1 * 60 * 1000;
// 单次向服务器请求数据的范围（默认 6 小时，超过后采集频率间隔会变长），单位: ms
const DEFAULT_REQUEST_TIME_RANGE = 6 * 60 * 60 * 1000;
// 采样间隔，影响前端补点逻辑，单位: ms
const DEFAULT_POINT_INTERVAL = 60 * 1000;
// 向服务器每轮请求的数量
const DEFAULT_REQUEST_COUNT = 6;
// 进入详情页默认展示的时间范围
const DEFAULT_ENTER_TIME_RANGE = 2 * 60 * 60 * 1000;
// 预缓存数据阈值，图表展示数据的开始时间处于前端缓存数据的时间范围的前 40% 时，向服务器请求数据
const PRECACHE_THRESHOLD = 0.4;

// 表格列
const colunms = [
  {
    title: 'Host',
    dataIndex: 'name',
    width: 200,
    render(name: string, record: any) {
      return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 8, height: 2, marginRight: 4, background: record.color }}></div>
          <span>{name}</span>
        </div>
      );
    },
  },
  {
    title: 'Avg',
    dataIndex: 'avg',
    width: 120,
    render(num: number) {
      return num.toFixed(2);
    },
  },
  {
    title: 'Max',
    dataIndex: 'max',
    width: 120,
    render(num: number, record: any) {
      return (
        <div>
          <span>{num.toFixed(2)}</span>
        </div>
      );
    },
  },
  {
    title: 'Min',
    dataIndex: 'min',
    width: 120,
    render(num: number, record: any) {
      return (
        <div>
          <span>{num.toFixed(2)}</span>
        </div>
      );
    },
  },
  {
    title: 'Latest',
    dataIndex: 'latest',
    width: 120,
    render(latest: number[]) {
      return `${latest[1].toFixed(2)}`;
    },
  },
];

const ChartDetail = (props: ChartDetailProps) => {
  const [global] = AppContainer.useGlobalValue();
  const { clusterId } = useParams<{
    clusterId: string;
  }>();
  const { metricType, metricName, queryLines, onClose } = props;

  // 存储图表相关的不需要触发渲染的数据，用于计算图表展示状态并进行操作
  const chartInfo = useRef(
    (() => {
      // 当前时间减去 1 分钟，避免最近一分钟的数据还没采集到时前端多补一个点
      const curTime = moment().valueOf() - 60 * 1000;
      const curTimeRange = [curTime - DEFAULT_ENTER_TIME_RANGE, curTime] as const;

      return {
        chartInstance: undefined as echarts.ECharts,
        isLoadedFullData: false,
        fullTimeRange: curTimeRange,
        fullMetricData: {} as MetricChartDataType,
        curTimeRange,
        oldDataZoomOption: {} as any,
        sliderPos: [0, 0] as readonly [number, number],
        sliderRange: '',
        transformUnit: undefined as [string, number],
      };
    })()
  );

  const [loading, setLoading] = useState(false);
  // 当前展示的图表数据
  const [curMetricData, setCurMetricData] = useState<MetricChartDataType>();
  // 图表数据的各项计算指标
  const [tableInfo, setTableInfo] = useState<MetricTableInfo[]>([]);
  // 选中展示的图表
  const [selectedLines, setSelectedLines] = useState<string[]>([]);

  // 请求图表数据
  const getMetricChartData = ([startTime, endTime]: readonly [number, number]) => {
    return Utils.post(api.getDashboardMetricChartData(clusterId, metricType), {
      startTime,
      endTime,
      metricsNames: [metricName],
      topNu: null,
      [metricType === MetricType.Broker ? 'brokerIds' : 'topics']: queryLines,
    });
  };

  const onDataZoomDrag = ({ start, end }: DataZoomEventProps) => {
    // dispatchAction 更新拖拽位置的情况，直接跳出
    if (!start && !end) {
      return false;
    }

    const {
      fullTimeRange: [fullStartTimestamp, fullEndTimestamp],
      curTimeRange: [oldStartTimestamp, oldEndTimestamp],
      oldDataZoomOption,
      isLoadedFullData,
      chartInstance,
    } = chartInfo.current;
    const { start: oldStart, end: oldEnd, startValue: oldStartSliderPos, endValue: oldEndSliderPos } = oldDataZoomOption;
    // 获取拖动后左右滑块的绝对位置
    const newDataZoomOption = (chartInstance.getOption() as any).dataZoom[0];
    const { startValue: newStartSliderPos, endValue: newEndSliderPos } = newDataZoomOption;
    // 计算 扩大/缩小 的比例
    const oldScale = (oldEnd - oldStart) / 100;
    const newScale = (end - start) / 100;
    const scaleRate = newScale / oldScale;

    // 如果滑块整体拖动，则只更新拖动后滑块的位（保留小数点后三位是防止低位值的干扰）
    if (oldScale.toFixed(3) === newScale.toFixed(3)) {
      chartInfo.current = {
        ...chartInfo.current,
        sliderPos: [newStartSliderPos, newEndSliderPos],
        oldDataZoomOption: newDataZoomOption,
      };
      renderTableInfo();

      return false;
    }
    // 滑块 左侧/右侧 区域所占时间范围
    const oldLeftTimeRange = oldStartSliderPos - oldStartTimestamp;
    const oldRightTimeRange = oldEndTimestamp - oldEndSliderPos;
    let leftExpandTimeRange = oldLeftTimeRange * scaleRate;
    let rightExpandTimeRange = oldRightTimeRange * scaleRate;
    let newStartTimestamp, newEndTimestamp;

    if (scaleRate > 1) {
      // 2. 滑块拖动后缩放比例变大
      // 扩张后的右侧边界
      newEndTimestamp = newEndSliderPos + rightExpandTimeRange;
      let rightOverRange = 0;
      // 计算右侧是否能扩张这么多
      if (newEndTimestamp > fullEndTimestamp) {
        rightOverRange = newEndTimestamp - fullEndTimestamp;
        newEndTimestamp = fullEndTimestamp;
      }

      // 扩张后的左侧边界
      newStartTimestamp = newStartSliderPos - leftExpandTimeRange - rightOverRange;
      // 在已经加载到全部数据的情况下，如果左侧扩张后的边界大于左侧最终边界，并且右侧边界还能扩张，则向右扩张
      if (isLoadedFullData && newStartTimestamp < fullStartTimestamp && newEndTimestamp < fullEndTimestamp) {
        const leftOverRange = fullStartTimestamp - newStartTimestamp;
        if (newEndTimestamp + leftOverRange >= fullEndTimestamp) {
          newEndTimestamp = fullEndTimestamp;
        } else {
          newEndTimestamp += leftOverRange;
        }

        newStartTimestamp = fullStartTimestamp;
      }
    } else {
      // 3. 滑块拖动后缩放比例变小
      // 判断拖动后选择的时间范围并提示
      if (newEndSliderPos - newStartSliderPos < LEAST_SELECTED_TIME_RANGE) {
        // TODO: 补充逻辑
        updateChartData([oldStartTimestamp, oldEndTimestamp], [oldStartSliderPos, oldEndSliderPos]);
        message.warning(`当前选择范围小于 ${LEAST_SELECTED_TIME_RANGE / 60 / 1000} 分钟，图表可能无数据`);
        return true;
      }

      const isOldLarger = oldScale - DATA_ZOOM_DEFAULT_SCALE > 0.01;
      const isNewLarger = newScale - DATA_ZOOM_DEFAULT_SCALE > 0.01;
      if (isOldLarger && isNewLarger) {
        // 如果拖拽前后比例均高于默认比例，则不对图表展示范围进行操作
        chartInfo.current = {
          ...chartInfo.current,
          sliderPos: [newStartSliderPos, newEndSliderPos],
          oldDataZoomOption: newDataZoomOption,
        };
        renderTableInfo();
        return true;
      } else {
        // 如果拖拽前比例高于默认比例，拖拽后比例低于默认比例，则重新计算缩放比例，目的是保证拖拽后显示范围占的比例为默认比例
        if (isOldLarger && !isNewLarger) {
          const newScaleRate =
            (((newEndSliderPos - newStartSliderPos) / DATA_ZOOM_DEFAULT_SCALE) * (1 - DATA_ZOOM_DEFAULT_SCALE)) /
            (oldLeftTimeRange | oldRightTimeRange);
          leftExpandTimeRange = oldLeftTimeRange * newScaleRate;
          rightExpandTimeRange = oldRightTimeRange * newScaleRate;
        }

        newStartTimestamp = newStartSliderPos - leftExpandTimeRange;
        newEndTimestamp = newEndSliderPos + rightExpandTimeRange;
      }
    }

    // 这时已经获取到了 扩张后需要的图表时间范围 和 扩张后的滑块的绝对位置，更新图表数据
    updateChartData([newStartTimestamp, newEndTimestamp], [newStartSliderPos, newEndSliderPos]);
    return true;
  };

  const updateChartData = (timeRange: [number, number], sliderPos: [number, number]) => {
    const {
      fullTimeRange: [fullStartTimestamp, fullEndTimestamp],
      fullMetricData,
      isLoadedFullData,
    } = chartInfo.current;
    let leftBoundaryTimestamp = Math.floor(timeRange[0]);
    const isNeedCacheExtraData = leftBoundaryTimestamp < fullStartTimestamp + (fullEndTimestamp - fullStartTimestamp) * PRECACHE_THRESHOLD;

    let isRendered = false;
    // 如果本地存储的数据足够展示或者已经获取到所有数据，则展示数据
    if (leftBoundaryTimestamp > fullStartTimestamp || isLoadedFullData) {
      chartInfo.current = {
        ...chartInfo.current,
        curTimeRange: [leftBoundaryTimestamp > fullStartTimestamp ? leftBoundaryTimestamp : fullStartTimestamp, timeRange[1]],
        sliderPos,
      };
      renderNewMetricData();
      isRendered = true;
    }

    if (!isLoadedFullData && isNeedCacheExtraData) {
      // 向服务器请求新的数据缓存
      let reqEndTime = fullStartTimestamp;
      const requestArr: any[] = [];
      const requestTimeRanges: [number, number][] = [];
      for (let i = 0; i < DEFAULT_REQUEST_COUNT; i++) {
        setTimeout(() => {
          const nextReqEndTime = reqEndTime - DEFAULT_REQUEST_TIME_RANGE;
          requestArr.unshift(getMetricChartData([nextReqEndTime, reqEndTime]));
          requestTimeRanges.unshift([nextReqEndTime, reqEndTime]);
          reqEndTime = nextReqEndTime;

          // 当最后一次请求发送后，处理返回
          if (i === DEFAULT_REQUEST_COUNT - 1) {
            Promise.all(requestArr).then((resList) => {
              let isSettle = -1;
              // 填充增量的图表数据
              resList.forEach((res: MetricDefaultChartDataType[], i) => {
                // 图表没有返回数据的情况
                if (!res?.length) {
                  if (isSettle === -1) {
                    chartInfo.current = {
                      ...chartInfo.current,
                      //  标记数据已经全部加载完毕
                      isLoadedFullData: true,
                    };
                    isSettle = i;
                  }
                } else {
                  resolveAdditionChartData(res, requestTimeRanges[i]);
                }
              });
              // 更新左侧边界为当前已获取到数据的最小边界
              const curLocalStartTimestamp = Number(fullMetricData.metricLines.map((line) => line.data[0][0]).sort()[0]);
              if (leftBoundaryTimestamp < curLocalStartTimestamp) {
                leftBoundaryTimestamp = curLocalStartTimestamp;
              }

              chartInfo.current = {
                ...chartInfo.current,
                fullTimeRange: [reqEndTime - DEFAULT_REQUEST_TIME_RANGE, fullEndTimestamp],
                sliderPos,
              };
              if (!isRendered) {
                chartInfo.current = {
                  ...chartInfo.current,
                  curTimeRange: [leftBoundaryTimestamp, timeRange[1]],
                };
                renderNewMetricData();
              }
            });
          }
        }, i * 10);
      }
    }
  };

  // 处理增量图表数据
  const resolveAdditionChartData = (res: MetricDefaultChartDataType[], timeRange: [number, number]) => {
    // 格式化图表需要的数据
    const formattedMetricData = formatChartData(
      res,
      global.getMetricDefine || {},
      metricType,
      timeRange,
      DEFAULT_POINT_INTERVAL,
      false,
      chartInfo.current.transformUnit
    ) as MetricChartDataType[];
    // 增量填充图表数据
    const additionMetricPoints = formattedMetricData[0].metricLines;
    Object.values(additionMetricPoints).forEach((additionLine) => {
      const curLines = chartInfo.current.fullMetricData.metricLines;
      const curLine = curLines.find(({ name: metricName }) => {
        return additionLine.name === metricName;
      });
      if (!curLine) {
        // 如果没找到，说明是新的节点，直接存储
        curLines.push(additionLine);
      } else {
        curLine.data = additionLine.data.concat(curLine.data);
      }
    });
  };

  // 根据需要展示的时间范围过滤出对应的数据展示
  const renderNewMetricData = () => {
    const { fullMetricData, curTimeRange } = chartInfo.current;
    const newMetricData = { ...fullMetricData };
    newMetricData.metricLines = [...newMetricData.metricLines];
    newMetricData.metricLines.forEach((line, i) => {
      line = {
        ...line,
      };
      line.data = [...line.data];
      line.data = line.data.filter((point) => {
        const result = curTimeRange[0] <= point[0] && point[0] <= curTimeRange[1];
        return result;
      });
      newMetricData.metricLines[i] = line;
    });
    // 只过滤出当前时间段有数据点的线条，确保 Table 统一展示
    newMetricData.metricLines = newMetricData.metricLines.filter((line) => line.data.length);
    setCurMetricData(newMetricData);
  };

  // 计算当前选中范围
  const calculateSliderRange = () => {
    const { sliderPos } = chartInfo.current;
    let minutes = Number(((sliderPos[1] - sliderPos[0]) / 60 / 1000).toFixed(2));
    let hours = 0;
    let days = 0;
    if (minutes > 60) {
      hours = Math.floor(minutes / 60);
      minutes = Number((minutes % 60).toFixed(2));
    }
    if (hours > 24) {
      days = Math.floor(hours / 24);
      hours = Number((hours % 24).toFixed(2));
    }

    chartInfo.current = {
      ...chartInfo.current,
      sliderRange: ` 当前选中范围: ${days > 0 ? `${days} 天 ` : ''}${hours > 0 ? `${hours} 小时 ` : ''}${minutes} 分钟`,
    };
  };

  // 遍历图表，获取需要的指标数据，展示到 Table
  const renderTableInfo = () => {
    const tableData: MetricTableInfo[] = [];
    const { sliderPos, chartInstance } = chartInfo.current;
    const { color }: any = chartInstance.getOption();

    curMetricData.metricLines.forEach(({ name, data }, i) => {
      const lineInfo: MetricTableInfo = {
        name,
        avg: -1,
        max: -1,
        min: Number.MAX_SAFE_INTEGER,
        latest: ['0', -1],
        color: color[i % color.length],
      };

      const curShowPoints = data.filter((point) => sliderPos[0] < point[0] && point[0] < sliderPos[1]);
      // 如果该节点在当前时间范围无数据，直接退出
      if (!curShowPoints.length) {
        return false;
      }
      const all = curShowPoints.reduce((pre: number, cur) => {
        const curVal = cur[1] as number;

        if (curVal > lineInfo.max) {
          lineInfo.max = curVal;
        }
        if (curVal < lineInfo.min) {
          lineInfo.min = curVal;
        }

        pre += curVal;
        return pre;
      }, 0);

      lineInfo.avg = all / curShowPoints.length;
      lineInfo.latest = curShowPoints[curShowPoints.length - 1];
      tableData.push(lineInfo);
      return true;
    });

    calculateSliderRange();
    setTableInfo(tableData);
    setSelectedLines(tableData.map((line) => line.name));
  };

  const tableLineChange = (keys: string[]) => {
    const updatedLines: { [name: string]: boolean } = {};
    selectedLines.forEach((name) => !keys.includes(name) && (updatedLines[name] = false));
    keys.forEach((name) => !selectedLines.includes(name) && (updatedLines[name] = true));

    // 更新
    Object.keys(updatedLines).forEach((name) => {
      chartInfo.current.chartInstance.dispatchAction({
        type: 'legendToggleSelect',
        // 图例名称
        name: name,
      });
    });

    setSelectedLines(keys);
  };

  useEffect(() => {
    if (curMetricData) {
      setTimeout(() => {
        // 新的图表数据渲染后，更新图表拖拽轴信息
        chartInfo.current.oldDataZoomOption = (chartInfo.current.chartInstance.getOption() as any).dataZoom[0];
      });
      renderTableInfo();
    }
  }, [curMetricData]);

  // 进入详情时，首次获取数据
  useEffect(() => {
    if (metricType && metricName) {
      setLoading(true);
      const { curTimeRange } = chartInfo.current;
      getMetricChartData(curTimeRange).then((res: any[] | null) => {
        // 如果图表返回数据
        if (res?.length) {
          // 格式化图表需要的数据
          const formattedMetricData = (
            formatChartData(
              res,
              global.getMetricDefine || {},
              metricType,
              curTimeRange,
              DEFAULT_POINT_INTERVAL,
              false
            ) as MetricChartDataType[]
          )[0];
          // 填充图表数据
          let initFullTimeRange = curTimeRange;
          const pointsOfFirstLine = formattedMetricData.metricLines.find((line) => line.data.length).data;
          if (pointsOfFirstLine) {
            initFullTimeRange = [pointsOfFirstLine[0][0] as number, pointsOfFirstLine[pointsOfFirstLine.length - 1][0] as number] as const;
          }

          // 获取单位保存起来
          let transformUnit = undefined;
          Object.entries(UNIT_MAP).forEach((unit) => {
            if (formattedMetricData.metricUnit.includes(unit[0])) {
              transformUnit = unit;
            }
          });

          chartInfo.current = {
            ...chartInfo.current,
            fullMetricData: formattedMetricData,
            fullTimeRange: [...initFullTimeRange],
            curTimeRange: [...initFullTimeRange],
            sliderPos: [
              initFullTimeRange[1] - (initFullTimeRange[1] - initFullTimeRange[0]) * DATA_ZOOM_DEFAULT_SCALE,
              initFullTimeRange[1],
            ],
            transformUnit,
          };
          setCurMetricData(formattedMetricData);
          setLoading(false);
        }
      });
    }
  }, []);

  const debounced = debounce(onDataZoomDrag, 300);

  return (
    <Spin spinning={loading}>
      <div className="chart-detail-modal-container">
        {curMetricData && (
          <>
            <div className="detail-title">
              <div className="left">
                <div className="title">
                  <Tooltip
                    placement="bottomLeft"
                    title={() => {
                      let content = '';
                      const metricDefine = global.getMetricDefine(metricType, curMetricData.metricName);
                      if (metricDefine) {
                        content = metricDefine.desc;
                      }
                      return content;
                    }}
                  >
                    <span style={{ cursor: 'pointer' }}>
                      <span>{curMetricData.metricName}</span> <span className="unit">({curMetricData.metricUnit}) </span>
                    </span>
                  </Tooltip>
                </div>
                <div className="info">{chartInfo.current.sliderRange}</div>
              </div>
              <div className="right">
                <Button type="text" size="small" onClick={onClose}>
                  <CloseOutlined />
                </Button>
              </div>
            </div>
            <SingleChart
              chartTypeProp="line"
              wrapStyle={{
                width: 'auto',
                height: 462,
              }}
              onEvents={{
                dataZoom: (record: any) => {
                  debounced(record);
                },
              }}
              propChartData={curMetricData.metricLines}
              optionMergeProps={{ notMerge: true }}
              getChartInstance={(chartInstance) => {
                chartInfo.current = {
                  ...chartInfo.current,
                  chartInstance,
                };
              }}
              {...getDetailChartConfig(`${curMetricData.metricName}{unit|（${curMetricData.metricUnit}）}`, chartInfo.current.sliderPos)}
            />
            <Table
              className="detail-table"
              rowKey="name"
              rowSelection={{
                // hideSelectAll: true,
                preserveSelectedRowKeys: true,
                selectedRowKeys: selectedLines,
                // getCheckboxProps: (record) => {
                //   return selectedLines.length <= 1 && selectedLines.includes(record.name)
                //     ? {
                //         disabled: true,
                //       }
                //     : {};
                // },
                selections: [Table.SELECTION_INVERT, Table.SELECTION_NONE],
                onChange: (keys: string[]) => tableLineChange(keys),
              }}
              scroll={{
                x: 'max-content',
                y: 'calc(100vh - 582px)',
              }}
              dataSource={tableInfo}
              columns={colunms as any}
              pagination={false}
            />
          </>
        )}
      </div>
    </Spin>
  );
};

// eslint-disable-next-line react/display-name
const ChartDrawer = forwardRef((_, ref) => {
  const [visible, setVisible] = useState(false);
  const [dashboardType, setDashboardType] = useState<MetricType>();
  const [metricName, setMetricName] = useState<string>();
  const [queryLines, setQueryLines] = useState<string[]>([]);

  const onOpen = (dashboardType: MetricType, metricName: string, queryLines: string[]) => {
    setDashboardType(dashboardType);
    setMetricName(metricName);
    setQueryLines(queryLines);
    setVisible(true);
  };

  const onClose = () => {
    setVisible(false);
    setDashboardType(undefined);
    setMetricName(undefined);
  };

  useImperativeHandle(ref, () => ({
    onOpen,
  }));

  return (
    <Drawer width={1080} visible={visible} footer={null} closable={false} maskClosable={false} destroyOnClose={true} onClose={onClose}>
      {dashboardType && metricName && (
        <ChartDetail metricType={dashboardType} metricName={metricName} queryLines={queryLines} onClose={onClose} />
      )}
    </Drawer>
  );
});

export default ChartDrawer;
