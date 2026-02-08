import * as vscode from 'vscode';

export interface TaskToken {
  readonly isCanceled: boolean;
  finished(): void;
}

export type CancelCallback = () => void;

/**
 * Task with async operation. It will be enqueued to and managed by
 * TaskQueue. Useful for spawning ChildProcess.
 */
export class Task {
  public readonly uri: vscode.Uri;
  public isEnqueued: boolean = false;
  private body: (token: TaskToken) => CancelCallback;
  private isCanceled: boolean = false;
  private resolver?: () => void;
  private onCancel?: CancelCallback;

  /**
   * @param body Function of task body, which returns callback called
   *             when cancelation is requested. You should call
   *             token.finished() after async operation is done.
   */
  constructor(uri: vscode.Uri, body: (token: TaskToken) => CancelCallback) {
    this.uri = uri;
    this.body = body;
  }

  public run(): Promise<void> {
    if (this.isCanceled) {
      return Promise.resolve();
    }
    let task = this;
    return new Promise<void>((resolve, reject) => {
      task.resolver = () => resolve();
      let token = {
        get isCanceled(): boolean {
          return task.isCanceled;
        },

        finished(): void {
          task.resolveOnce();
        },
      };
      task.onCancel = this.body(token);
    });
  }

  public cancel(): void {
    if (this.isCanceled) {
      return;
    }
    this.isCanceled = true;
    if (this.onCancel) {
      this.onCancel();
    }
    this.resolveOnce();
  }

  private resolveOnce(): void {
    if (this.resolver) {
      this.resolver();
      this.resolver = undefined;
    }
  }
}

/**
 * Provides single-threaded task queue which runs single asynchronous
 * Task at a time. This restricts concurrent execution of packwerk
 * processes to prevent from running out machine resource.
 */
export class TaskQueue {
  private tasks: Task[] = [];
  private busy: boolean = false;
  private log: (message: string) => void;

  constructor(log?: (message: string) => void) {
    this.log = log || (() => {});
  }

  public get length(): number {
    return this.tasks.length;
  }

  public enqueue(task: Task): void {
    if (task.isEnqueued) {
      throw new Error('Task is already enqueued. (uri: ' + task.uri + ')');
    }

    this.log(`TaskQueue: Enqueueing task for ${task.uri}, busy=${this.busy}, queueLength=${this.tasks.length}`);
    this.cancel(task.uri);
    task.isEnqueued = true;
    this.tasks.push(task);
    this.kick();
  }

  public cancel(uri: vscode.Uri): void {
    let uriString = uri.toString(true);
    this.tasks.forEach((task) => {
      if (task.uri.toString(true) === uriString) {
        this.log(`TaskQueue: Canceling existing task for ${task.uri}`);
        task.cancel();
      }
    });
  }

  private async kick(): Promise<void> {
    if (this.busy) {
      this.log(`TaskQueue: kick() called but busy, skipping`);
      return;
    }
    this.busy = true;
    this.log(`TaskQueue: Starting to process queue`);
    while (true) {
      let task: Task | undefined = this.tasks[0];
      if (!task) {
        this.busy = false;
        this.log(`TaskQueue: Queue empty, done`);
        return;
      }
      try {
        this.log(`TaskQueue: Running task for ${task.uri}`);
        await task.run();
        this.log(`TaskQueue: Task completed for ${task.uri}`);
      } catch (e) {
        this.log(`TaskQueue: Task error for ${task.uri}: ${e.message}`);
        console.error('Error while running packwerk: ', e.message, e.stack);
      }
      this.tasks.shift();
    }
  }
}
