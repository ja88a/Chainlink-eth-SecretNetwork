#!/bin/sh
docker exec -it kafka \
    kafka-broker-api-versions --bootstrap-server localhost:9092 --version
docker exec -it zookeeper \
    echo "status" | nc  localhost 2181 | head -n 1
    # Note for the above cmd: refer to zookeeper env KAFKA_OPT="zookeeper.4lw.commands.whitelist=*"
echo 
docker --version
java -version
