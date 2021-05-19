import {KafkaOptions, Transport} from "@nestjs/microservices";

export const configMS: KafkaOptions = {
    transport: Transport.KAFKA,

    options: {
        client: {
            clientId: "dummyClient0",
            brokers: ["127.0.0.1:9092"],
        },
        consumer: {
            groupId: 'consumerGroup0',
            allowAutoTopicCreation: true,
        },
    }
};
