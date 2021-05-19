# Docker Kafka Shell Scripts
## Description

This project includes a docker compose yml file which can be used to setup a local kafka env.
These are a set of execution scripts for managing a docker embedded Kafka instance

## Setup environment
```
$ chmod +x ./script/make-commands-executable.sh

$ ./script/make-commands-executable.sh
```

### Start up the docker compose - bring up zookeeper and kafka
Kafka will start at port 9092

```
$ ./script/start
```

### Stop the docker compose
```
$ ./script/stop
```


## Kafka commands

### Operational related commands

#### List available brokers
```
$ ./script/list-brokers
```
#### Show kafka logs
```
$ ./script/logs
```
#### Show kafka version
```
$ ./script/version
```
#### Get a bash shell on the kafka docker instance
```
$ ./script/shell
```
#### Run a command on inside the kafka docker instance
```
$ ./script/run-within-docker <the_command_that_you_would_like_to_run>
```
### Topic related commands

#### List current topics
```
$ ./script/topic/list
```
#### Create a new kafka topic
* created with replication-factor 1 and partitions 1
```
$ ./script/topic/create <topic_name>
```
#### Pick a look at the details of a topic
```
$ ./script/topic/details <topic_name>
```
#### Delete a topic
```
$ ./script/topic/delete <topic_name>
```
#### Purge topic content
```
$ ./script/topic/purge
```
#### Change topic retention
```
$ ./script/topic/change-retention <topic_name> <retention_time_in_msec>
```
#### Increase topic partitions
```
$ ./script/topic/increase-partition <topic_name> <new_partition_size>
```

### Message related commands
#### Produce a new message
Each line is a new message, hit ctrl-c to end.
```
$ ./script/message/produce <topic_name>
```
#### Consume new messages from last time
```
$ ./script/message/consume <topic_name>
```
#### Consume new messages from the beginning
```
$ ./script/message/consume-from-beginning <topic_name>
```
