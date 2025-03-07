package com.xiaojukeji.know.streaming.km.task.metadata;

import com.didiglobal.logi.job.annotation.Task;
import com.didiglobal.logi.job.common.TaskResult;
import com.didiglobal.logi.job.core.consensual.ConsensualEnum;
import com.didiglobal.logi.log.ILog;
import com.didiglobal.logi.log.LogFactory;
import com.xiaojukeji.know.streaming.km.common.bean.entity.cluster.ClusterPhy;
import com.xiaojukeji.know.streaming.km.common.bean.entity.result.Result;
import com.xiaojukeji.know.streaming.km.common.bean.entity.topic.Topic;
import com.xiaojukeji.know.streaming.km.core.service.topic.TopicService;
import com.xiaojukeji.know.streaming.km.task.AbstractClusterPhyDispatchTask;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;

@Task(name = "SyncTopicTask",
        description = "Topic信息同步到DB,",
        cron = "0 0/1 * * * ? *",
        autoRegister = true,
        consensual = ConsensualEnum.BROADCAST,
        timeout = 2 * 60)
public class SyncTopicTask extends AbstractClusterPhyDispatchTask {
    private static final ILog log = LogFactory.getLog(SyncTopicTask.class);

    @Autowired
    private TopicService topicService;

    @Override
    public TaskResult processSubTask(ClusterPhy clusterPhy, long triggerTimeUnitMs) {
        Result<List<Topic>> topicsResult = topicService.listTopicsFromKafka(clusterPhy);
        if (topicsResult.failed()) {
            return new TaskResult(TaskResult.FAIL_CODE, topicsResult.getMessage());
        }

        topicService.batchReplaceMetadata(clusterPhy.getId(), topicsResult.getData());
        return TaskResult.SUCCESS;
    }
}
