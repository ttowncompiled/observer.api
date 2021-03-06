import {OnComplete, OnError, OnNext} from '../types';
import {
  AbstractObservable,
  AbstractSubject,
  Generator,
  Observer,
  Transform} from '../core';
import {Scheduler} from './scheduler';

export abstract class Observable<T> implements AbstractObservable<T> {

  isDisposed: boolean;
  _scheduler: Scheduler;
  _subscribers: Observer<T>[];

  abstract dispose(): void;

  abstract subscribe(subscriber: Observer<T>): void;

  static create<E>(cb: Generator<E>): Observable<E> {
    return new ColdObservable<E>(cb);
  }

  static defer<E>(cb: Generator<E>): Observable<E> {
    return new DeferredObservable<E>(cb);
  }

  static empty<E>(): Observable<E> {
    return new ColdObservable<E>(observer => {
      observer.complete();
    });
  }

  static from<E>(sequence: E[]): Observable<E> {
    return new ColdObservable<E>(observer => {
      for (let object of sequence) {
        observer.next(object);
      }
      observer.complete();
    });
  }

  static merge<E>(...subscriptions: Observable<E>[]): Observable<E> {
    let subject: Subject<E> = new Subject<E>();
    for (let subscription of subscriptions) {
      subject.subscribeTo(subscription);
    }
    subject.dispose();
    return subject;
  }

  static of<E>(object?: E): Observable<E> {
    return new ColdObservable<E>(observer => {
      observer.next(object);
      observer.complete();
    });
  }

  static start<E>(cb: Generator<E>): Observable<E> {
    return new HotObservable<E>(cb);
  }

  static throw<E>(err: any): Observable<E> {
    return new ColdObservable<E>(observer => {
      observer.error(err);
      observer.complete();
    });
  }

  constructor() {
    this.isDisposed = false;
    this._scheduler = new Scheduler();
    this._subscribers = [];
  }

  join(...subscriptions: Observable<T>[]): Observable<T> {
    let subject: Subject<T> = new Subject<T>();
    subject.subscribeTo(this);
    for (let subscription of subscriptions) {
      subject.subscribeTo(subscription);
    }
    subject.dispose();
    return subject;
  }

  map<R>(mapping: Transform<T, R>): Observable<R> {
    return new MapSubject<T, R>(this, mapping);
  }

  subscribeOnComplete(complete: OnComplete<T>): void {
    let observer: Observer<T> = {
      complete: complete,
      error: this._throw,
      next: () => {}
    };
    this.subscribe(observer);
  }

  subscribeOnError(error: OnError): void {
    let observer: Observer<T> = {
      complete: () => {},
      error: error,
      next: () => {}
    };
    this.subscribe(observer);
  }

  subscribeOnNext(next: OnNext<T>): void {
    let observer: Observer<T> = {
      complete: () => {},
      error: this._throw,
      next: next
    };
    this.subscribe(observer);
  }

  _assertNoComplete(): void {
    throw new Error('An Observable called complete after being disposed.');
  }

  _assertNoError(): void {
    throw new Error('An Observable called error after being disposed.');
  }

  _assertNoNext(): void {
    throw new Error('An Observable called next after being disposed.');
  }

  _assertNoSubscribe(): void {
    throw new Error('An Observable was subscribed to after being disposed.');
  }

  _throw(err: any): void {
    throw err;
  }
}

export class ColdObservable<T> extends Observable<T> {

  _cb: Generator<T>;

  constructor(cb: Generator<T>) {
    super();
    this._cb = cb;
  }

  dispose(): void {
    this.isDisposed = true;
  }

  subscribe(...subscribers: Observer<T>[]): void {
    if (this.isDisposed) {
      this._assertNoSubscribe();
    }
    let observerCompleted: boolean = false;
    let observer: Observer<T> = {
      complete: () => {
        if (observerCompleted) {
          this._assertNoComplete();
        }
        observerCompleted = true;
        this._scheduler.schedule<T>(subscribers, subscriber => {
          subscriber.complete(this);
        });
      },
      error: err => {
        if (observerCompleted) {
          this._assertNoError();
        }
        this._scheduler.schedule<T>(subscribers, subscriber => {
          subscriber.error(err);
        });
      },
      next: object => {
        if (observerCompleted) {
          this._assertNoNext();
        }
        this._scheduler.schedule<T>(subscribers, subscriber => {
          subscriber.next(object);
        });
      }
    };
    setTimeout(() => {
      try {
        this._cb(observer);
      } catch (err) {
        observer.error(err);
      }
    });
  }
}

export abstract class PublishableObservable<T> extends Observable<T> {

  _cb: Generator<T>;
  _isPublished: boolean;

  constructor(cb: Generator<T>) {
    super();
    this._cb = cb;
    this._isPublished = true;
  }

  dispose(): void {
    this.isDisposed = true;
    this._scheduler.schedule<T>(this._subscribers, subscriber => {
      subscriber.complete(this);
    }).then(() => {
      this._subscribers = [];
    });
  }

  _publish(): void {
    this._isPublished = true;
    let observer: Observer<T> = {
      complete: () => {
        if (this.isDisposed) {
          this._assertNoComplete();
        }
        this.dispose();
      },
      error: err => {
        if (this.isDisposed) {
          this._assertNoError();
        }
        this._scheduler.schedule<T>(this._subscribers, subscriber => {
          subscriber.error(err);
        });
      },
      next: object => {
        if (this.isDisposed) {
          this._assertNoNext();
        }
        this._scheduler.schedule<T>(this._subscribers, subscriber => {
          subscriber.next(object);
        });
      }
    };
    setTimeout(() => {
      try {
        this._cb(observer);
      } catch (err) {
        observer.error(err);
      }
    });
  }

  get _shouldPublish(): boolean {
    return this._subscribers.length > 0;
  }
}

export class DeferredObservable<T> extends PublishableObservable<T> {

  constructor(cb: Generator<T>) {
    super(cb);
  }

  subscribe(...subscribers: Observer<T>[]): void {
    if (this.isDisposed) {
      this._assertNoSubscribe();
    }
    for (let subscriber of subscribers) {
      this._subscribers.push(subscriber);
    }
    if (!this._isPublished && this._shouldPublish) {
      this._publish();
    }
  }
}

export class HotObservable<T> extends PublishableObservable<T> {

  constructor(cb: Generator<T>) {
    super(cb);
    this._publish();
  }

  subscribe(...subscribers: Observer<T>[]): void {
    if (this.isDisposed) {
      this._assertNoSubscribe();
    }
    for (let subscriber of subscribers) {
      this._subscribers.push(subscriber);
    }
  }
}

export abstract class BaseSubject<T, R>
    extends Observable<R> implements AbstractSubject<T, R> {

  _disposeUponNoSubscriptions: boolean;
  _isPublished: boolean;
  _subscriptions: Observable<T>[];

  abstract next(object?: T): void;

  constructor() {
    super();
    this._disposeUponNoSubscriptions = false;
    this._isPublished = false;
    this._subscriptions = [];
  }

  complete(subscription?: Observable<T>): void {
    if (this.isDisposed) {
      this._assertNoComplete();
    }
    this._unsubscribeFrom(subscription);
  }

  dispose(): void {
    this._disposeUponNoSubscriptions = true;
    if (this._shouldDispose) {
      this._disposeSubject();
    }
  }

  error(err: any): void {
    if (this.isDisposed) {
      this._assertNoError();
    }
    this._scheduler.schedule<R>(this._subscribers, subscriber => {
      subscriber.error(err);
    });
  }

  subscribe(...subscribers: Observer<R>[]): void {
    if (this.isDisposed) {
      this._assertNoSubscribe();
    }
    for (let subscriber of subscribers) {
      this._subscribers.push(subscriber);
    }
    if (!this._isPublished && this._shouldPublish) {
      this._publish();
    }
  }

  subscribeTo(...subscriptions: Observable<T>[]): void {
    if (this._disposeUponNoSubscriptions) {
      this._assertNoSubscribeTo();
    }
    for (let subscription of subscriptions) {
      this._subscriptions.push(subscription);
    }
    if (this._isPublished) {
      for (let subscription of subscriptions) {
        subscription.subscribe(this);
      }
    }
  }

  _assertNoSubscribeTo(): void {
    throw new Error('Called subscribeTo on a Subject that has been disposed.');
  }

  _disposeSubject(): void {
    this.isDisposed = true;
    this._scheduler.schedule<R>(this._subscribers, subscriber => {
      subscriber.complete(this);
    }).then(() => {
      this._subscribers = [];
    });
  }

  _publish(): void {
    this._isPublished = true;
    this._subscriptions.forEach(subscription => {
      subscription.subscribe(this);
    });
  }

  get _shouldDispose(): boolean {
    return this._subscriptions.length === 0;
  }

  get _shouldPublish(): boolean {
    return this._subscribers.length > 0;
  }

  _unsubscribeFrom(subscription: Observable<T>): void {
    let idx: number = this._subscriptions.indexOf(subscription);
    if (idx > -1) {
      this._subscriptions.splice(idx, 1);
    }
    if (this._subscriptions.length === 0 && this._disposeUponNoSubscriptions) {
      this._disposeSubject();
    }
  }
}

export class Subject<T> extends BaseSubject<T, T> {

  constructor() {
    super();
  }

  next(object?: T): void {
    if (this.isDisposed) {
      this._assertNoNext();
    }
    this._scheduler.schedule<T>(this._subscribers, subscriber => {
      subscriber.next(object);
    });
  }
}

export abstract class TransformSubject<T, R> extends BaseSubject<T, R> {

  _transform: Transform<T, any>;

  abstract _compose(subscriber: Observer<R>, object: T): void;

  constructor(subscription: Observable<T>, transform: Transform<T, any>) {
    super();
    this.subscribeTo(subscription);
    this._disposeUponNoSubscriptions = true;
    this._transform = transform;
  }

  next(object?: T): void {
    if (this.isDisposed) {
      this._assertNoNext();
    }
    this._scheduler.schedule<R>(this._subscribers, subscriber => {
      try {
        this._compose(subscriber, object);
      } catch (err) {
        subscriber.error(err);
      }
    });
  }
}

export class FilterSubject<T> extends TransformSubject<T, T> {

  constructor(subscription: Observable<T>, transform: Transform<T, boolean>) {
    super(subscription, transform);
  }

  _compose(subscriber: Observer<T>, object: T): void {
    if (this._transform(object)) {
      subscriber.next(object);
    }
  }
}

export class MapSubject<T, R> extends TransformSubject<T, R> {

  constructor(subscription: Observable<T>, transform: Transform<T, R>) {
    super(subscription, transform);
  }

  _compose(subscriber: Observer<R>, object: T): void {
    subscriber.next(this._transform(object));
  }
}
