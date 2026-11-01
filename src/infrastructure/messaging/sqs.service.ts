import { CreateQueueCommand, GetQueueUrlCommand, ReceiveMessageCommand, type ReceiveMessageCommandOutput, SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SqsService implements OnModuleInit {
  private readonly client: SQSClient;
  private queueUrl?: string;
  private dlqUrl?: string;
  constructor(config: ConfigService) { this.client = new SQSClient({ region: config.get<string>('AWS_REGION') ?? 'us-east-1', endpoint: config.get<string>('SQS_ENDPOINT') ?? 'http://localhost:4566', credentials: { accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID') ?? 'test', secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY') ?? 'test' } }); }
  async onModuleInit(): Promise<void> { await this.ensureQueues(); }
  async isReady(): Promise<boolean> { try { await this.ensureQueues(); return true; } catch { return false; } }
  async send(payload: object): Promise<void> { await this.ensureQueues(); await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(payload), MessageGroupId: 'wagering', MessageDeduplicationId: crypto.randomUUID() })); }
  async receive(): Promise<ReceiveMessageCommandOutput> { await this.ensureQueues(); return this.client.send(new ReceiveMessageCommand({ QueueUrl: this.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 })); }
  private async ensureQueues(): Promise<void> { if (this.queueUrl && this.dlqUrl) return; await this.client.send(new CreateQueueCommand({ QueueName: 'wager-transactions-dlq.fifo', Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' } })); await this.client.send(new CreateQueueCommand({ QueueName: 'wager-transactions.fifo', Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' } })); this.queueUrl = (await this.client.send(new GetQueueUrlCommand({ QueueName: 'wager-transactions.fifo' }))).QueueUrl; this.dlqUrl = (await this.client.send(new GetQueueUrlCommand({ QueueName: 'wager-transactions-dlq.fifo' }))).QueueUrl; }
}
