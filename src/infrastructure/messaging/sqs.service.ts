import { CreateQueueCommand, DeleteMessageCommand, GetQueueAttributesCommand, GetQueueUrlCommand, ReceiveMessageCommand, type ReceiveMessageCommandOutput, SQSClient, SendMessageCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

@Injectable()
export class SqsService implements OnModuleInit {
  private readonly client: SQSClient;
  private readonly queueName: string;
  private readonly dlqName: string;
  private readonly eventQueueName: string;
  private queueUrl?: string;
  private dlqUrl?: string;
  private eventQueueUrl?: string;
  constructor(config: ConfigService) {
    this.client = new SQSClient({ region: config.get<string>('AWS_REGION') ?? 'us-east-1', endpoint: config.get<string>('SQS_ENDPOINT') ?? 'http://localhost:4566', credentials: { accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID') ?? 'test', secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY') ?? 'test' } });
    this.queueName = config.get<string>('SQS_QUEUE_NAME') ?? 'wager-transactions.fifo';
    this.dlqName = config.get<string>('SQS_DLQ_NAME') ?? 'wager-transactions-dlq.fifo';
    this.eventQueueName = config.get<string>('SQS_EVENT_QUEUE_NAME') ?? 'wager-events.fifo';
  }
  async onModuleInit(): Promise<void> { await this.ensureQueues(); }
  async isReady(): Promise<boolean> { try { await this.ensureQueues(); return true; } catch { return false; } }
  async send(payload: object): Promise<void> { await this.ensureQueues(); await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(payload), MessageGroupId: 'wagering', MessageDeduplicationId: randomUUID() })); }
  async sendEvent(payload: object): Promise<void> { await this.ensureQueues(); await this.client.send(new SendMessageCommand({ QueueUrl: this.eventQueueUrl, MessageBody: JSON.stringify(payload), MessageGroupId: 'wager-events', MessageDeduplicationId: randomUUID() })); }
  async receive(visibilityTimeoutSeconds?: number): Promise<ReceiveMessageCommandOutput> { await this.ensureQueues(); return this.client.send(new ReceiveMessageCommand({ QueueUrl: this.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: visibilityTimeoutSeconds })); }
  async receiveFromDlq(): Promise<ReceiveMessageCommandOutput> { await this.ensureQueues(); return this.client.send(new ReceiveMessageCommand({ QueueUrl: this.dlqUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 })); }
  async acknowledge(receiptHandle: string): Promise<void> { await this.ensureQueues(); await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle })); }
  private async ensureQueues(): Promise<void> { if (this.queueUrl && this.dlqUrl && this.eventQueueUrl) return; await this.client.send(new CreateQueueCommand({ QueueName: this.dlqName, Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' } })); this.dlqUrl = (await this.client.send(new GetQueueUrlCommand({ QueueName: this.dlqName }))).QueueUrl; const dlqArn = (await this.client.send(new GetQueueAttributesCommand({ QueueUrl: this.dlqUrl, AttributeNames: ['QueueArn'] }))).Attributes?.QueueArn; await this.client.send(new CreateQueueCommand({ QueueName: this.queueName, Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' } })); this.queueUrl = (await this.client.send(new GetQueueUrlCommand({ QueueName: this.queueName }))).QueueUrl; await this.client.send(new SetQueueAttributesCommand({ QueueUrl: this.queueUrl, Attributes: { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: '5' }) } })); await this.client.send(new CreateQueueCommand({ QueueName: this.eventQueueName, Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' } })); this.eventQueueUrl = (await this.client.send(new GetQueueUrlCommand({ QueueName: this.eventQueueName }))).QueueUrl; }
}
