
# FAQ 

## 8.1、支持哪些 Kafka 版本？

- 支持 0.10+ 的 Kafka 版本；
- 支持 ZK 及 Raft 运行模式的 Kafka 版本；

&nbsp;

## 8.1、2.x 版本和 3.0 版本有什么差异？

**全新设计理念**

- 在 0 侵入、0 门槛的前提下提供直观 GUI 用于管理和观测 Apache Kafka®，帮助用户降低 Kafka CLI 操作门槛，轻松实现对原生 Kafka 集群的可管、可见、可掌控，提升 Kafka 使用体验和降低管理成本。
- 支持海量集群一键接入，无需任何改造，即可实现集群深度纳管，真正的 0 侵入、插件化系统设计，覆盖 0.10.x-3.x.x 众多 Kafka 版本无缝纳管。

**开源协议调整**

- 3.x：AGPL 3.0
- 2.x：Apache License 2.0

更多具体内容见：[新旧版本对比](https://doc.knowstreaming.com/product/9-attachment#92%E6%96%B0%E6%97%A7%E7%89%88%E6%9C%AC%E5%AF%B9%E6%AF%94)

&nbsp;

## 8.3、页面流量信息等无数据？

- 1、`Broker JMX`未正确开启

可以参看：[Jmx 连接配置&问题解决](https://doc.knowstreaming.com/product/9-attachment#91jmx-%E8%BF%9E%E6%8E%A5%E5%A4%B1%E8%B4%A5%E9%97%AE%E9%A2%98%E8%A7%A3%E5%86%B3)

- 2、`ES` 存在问题

建议使用`ES 7.6`版本，同时创建近 7 天的索引，具体见：[快速开始](./1-quick-start.md) 中的 ES 索引模版及索引创建。

&nbsp;

## 8.4、`Jmx`连接失败如何解决？

- 参看 [Jmx 连接配置&问题解决](./9-attachment#jmx-连接失败问题解决) 说明。

&nbsp;

## 8.5、有没有 API 文档？

`KnowStreaming` 采用 Swagger 进行 API 说明，在启动 KnowStreaming 服务之后，就可以从下面地址看到。

Swagger-API 地址： [http://IP:PORT/swagger-ui.html#/](http://IP:PORT/swagger-ui.html#/)

&nbsp;

## 8.6、删除 Topic 成功后，为何过段时间又出现了？

**原因说明：**

`KnowStreaming` 会去请求 Topic 的 endoffset 信息，要获取这个信息就需要发送 metadata 请求，发送 metadata 请求的时候，如果集群允许自动创建 Topic，那么当 Topic 不存在时，就会自动将该 Topic 创建出来。

**问题解决：**

因为在 `KnowStreaming` 上，禁止 Kafka 客户端内部元信息获取这个动作非常的难做到，因此短时间内这个问题不好从 `KnowStreaming` 上解决。

当然，对于不存在的 Topic，`KnowStreaming` 是不会进行元信息请求的，因此也不用担心会莫名其妙的创建一个 Topic 出来。

但是，另外一点，对于开启允许 Topic 自动创建的集群，建议是关闭该功能，开启是非常危险的，如果关闭之后，`KnowStreaming` 也不会有这个问题。

最后这里举个开启这个配置后，非常危险的代码例子吧：

```java
for (int i= 0; i < 100000; ++i) {
    // 如果是客户端类似这样写的，那么一启动，那么将创建10万个Topic出来，集群元信息瞬间爆炸，controller可能就不可服务了。
    producer.send(new ProducerRecord<String, String>("know_streaming" + i,"hello logi_km"));
}
```

&nbsp;

## 8.7、如何在不登录的情况下，调用接口？

步骤一：接口调用时，在 header 中，增加如下信息：

```shell
# 表示开启登录绕过
Trick-Login-Switch : on

# 登录绕过的用户, 这里可以是admin, 或者是其他的, 但是必须在系统管理->用户管理中设置了该用户。
Trick-Login-User : admin
```

&nbsp;

步骤二：点击右上角"系统管理"，选择配置管理，在页面中添加以下键值对。

```shell
# 模块选择
SECURITY.LOGIN

# 设置的配置键，必须是这个
SECURITY.TRICK_USERS

# 设置的value，是json数组的格式，包含步骤一header中设置的用户名，例如
[ "admin", "logi"]
```

&nbsp;

步骤三：解释说明

设置完成上面两步之后，就可以直接调用需要登录的接口了。

但是还有一点需要注意，绕过的用户仅能调用他有权限的接口，比如一个普通用户，那么他就只能调用普通的接口，不能去调用运维人员的接口。

##  8.8、Specified key was too long; max key length is 767 bytes 

**原因：**不同版本的InoDB引擎，参数‘innodb_large_prefix’默认值不同，即在5.6默认值为OFF，5.7默认值为ON。

对于引擎为InnoDB，innodb_large_prefix=OFF，且行格式为Antelope即支持REDUNDANT或COMPACT时，索引键前缀长度最大为 767 字节。innodb_large_prefix=ON，且行格式为Barracuda即支持DYNAMIC或COMPRESSED时，索引键前缀长度最大为3072字节。

**解决方案：**

- 减少varchar字符大小低于767/4=191。
- 将字符集改为latin1（一个字符=一个字节）。
- 开启‘innodb_large_prefix’，修改默认行格式‘innodb_file_format’为Barracuda，并设置row_format=dynamic。

## 8.9、出现ESIndexNotFoundEXception报错

**原因 ：**没有创建ES索引模版

**解决方案：**执行init_es_template.sh脚本，创建ES索引模版即可。 
