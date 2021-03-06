import {expect} from 'chai';
import {Generator, Transform} from '../../src/core';
import {MapSubject, Observable} from '../../src/async/observables';

describe('Map Subject', () => {

  it('should emit the transform composed of the sequence', done => {
    let sequence: number[] = [1, 2, 3];
    let composition: number[] = [4, 5, 6];
    let cb: Generator<number> = observer => {
      sequence.forEach(object => {
        observer.next(object);
      });
    };
    let transform: Transform<number, number> = object => {
      return object + 3;
    };
    let observable: Observable<number> = Observable.create<number>(cb);
    let subject: MapSubject<number, number>
        = new MapSubject<number, number>(observable, transform);
    subject.subscribeOnNext(object => {
      expect(composition.indexOf(object)).to.be.above(-1);
      composition.splice(composition.indexOf(object), 1);
      if (composition.length === 0) {
        done();
      }
    });
  });

  it('should be disposed after its subscription completes', done => {
    let cb: Generator<void> = observer => {
      observer.complete();
    };
    let transform: Transform<void, void> = () => {};
    let observable: Observable<void> = Observable.create<void>(cb);
    let subject: MapSubject<void, void>
        = new MapSubject<void, void>(observable, transform);
    subject.subscribeOnComplete(() => {
      expect(subject.isDisposed).to.be.true;
      subject._scheduler.schedule<void>([null], () => {
        expect(subject._subscribers).to.be.empty;
        done();
      });
    });
  });

  it('should throw an error if it calls next after being disposed', done => {
    let observable: Observable<void> = Observable.create<void>(null);
    let subject: MapSubject<void, void>
        = new MapSubject<void, void>(observable, null);
    subject.complete(observable);
    try {
      subject.next();
    } catch (err) {
      done();
    }
  });

  it('should catch any error throw inside of its transform', done => {
    let zero: number = 0;
    let cb: Generator<number> = observer => {
      observer.next(zero);
    };
    let transform: Transform<number, void> = object => {
      throw new Error('map subject transform catch test');
    };
    let observable: Observable<number> = Observable.create<number>(cb);
    let subject: MapSubject<number, void>
        = new MapSubject<number, void>(observable, transform);
    subject.subscribeOnError(err => done());
  });

});
