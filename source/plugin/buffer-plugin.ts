/**
 * @license Use of this source code is governed by an MIT-style license that
 * can be found in the LICENSE file at https://github.com/cartant/rxjs-spy
 */

import { getGraphRef, GraphRef } from "./graph-plugin";
import { Logger, PartialLogger, toLogger } from "../logger";
import { BasePlugin } from "./plugin";
import { getSnapshotRef, SnapshotRef } from "./snapshot-plugin";
import { Spy } from "../spy-interface";
import { getStackTrace } from "./stack-trace-plugin";
import { SubscriptionRef } from "../subscription-ref";
import { inferType } from "../util";

interface BufferRef {
    sink: SubscriptionRef;
    sinkGraphRef: GraphRef;
    sinkSnapshotRef: SnapshotRef;
    sources: SubscriptionRef[];
    warned: boolean;
}

const bufferHigherOrderSymbol = Symbol("bufferHigherOrder");
const bufferRefSymbol = Symbol("bufferRef");

const higherOrderRegExp = /^(zip)$/;
const subscriptions: SubscriptionRef[] = [];
const unboundedRegExp = /^(buffer|bufferTime|bufferToggle|bufferWhen|delay|delayWhen|mergeMap|zip)$/;

export class BufferPlugin extends BasePlugin {

    private bufferThreshold_: number;
    private logger_: Logger;
    private spy_: Spy;

    constructor(spy: Spy, {
        bufferThreshold = 100,
        logger
    }: {
        bufferThreshold?: number,
        logger: PartialLogger
    }) {

        super("buffer");

        this.bufferThreshold_ = bufferThreshold;
        this.logger_ = toLogger(logger);
        this.spy_ = spy;
    }

    afterNext(ref: SubscriptionRef, value: any): void {

        const bufferRef: BufferRef = ref[bufferRefSymbol];
        if (!bufferRef) {
            return;
        }

        const { sink, sinkGraphRef, sinkSnapshotRef, sources } = bufferRef;
        const inputCount = sources.reduce((count, source) => {
            return Math.max(count, source.nextCount);
        }, 0);
        const flatteningsCount = sinkGraphRef.flattenings.length + sinkGraphRef.flatteningsFlushed;
        const outputCount = flatteningsCount || sink.nextCount;

        const { bufferThreshold_, logger_, spy_ } = this;
        const bufferCount = inputCount - outputCount;
        if ((bufferCount >= bufferThreshold_) && !bufferRef.warned) {
            bufferRef.warned = true;
            const stackFrames = getStackTrace(sinkGraphRef.rootSink || sink);
            if (stackFrames.length === 0) {
                spy_.warnOnce(console, "Stack tracing is not enabled; add the StackTracePlugin before the CyclePlugin.");
            }
            const stackTrace = stackFrames.length ? `; subscribed at\n${stackFrames.join("\n")}` : "";
            const type = inferType(sink.observable);
            logger_.warn(`Excessive buffering detected; type = ${type}; count = ${bufferCount}${stackTrace}`);
        }
        if (sinkSnapshotRef) {
            sinkSnapshotRef.query.bufferCount = bufferCount;
        }
    }

    afterSubscribe(ref: SubscriptionRef): void {

        subscriptions.pop();
    }

    beforeSubscribe(ref: SubscriptionRef): void {

        const snapshotRef = getSnapshotRef(ref);
        if (snapshotRef) {
            snapshotRef.query.bufferCount = 0;
        }

        subscriptions.push(ref);
        const length = subscriptions.length;
        if (length > 1) {
            const bufferRef = subscriptions[length - 2][bufferHigherOrderSymbol];
            if (bufferRef) {
                bufferRef.sources.push(ref);
                ref[bufferRefSymbol] = bufferRef;
                return;
            }
        }

        const graphRef = getGraphRef(ref);
        if (!graphRef) {
            this.spy_.warnOnce(console, "Graphing is not enabled; add the GraphPlugin before the BufferPlugin.");
            return;
        }

        const { sink } = graphRef;
        if (!sink || !unboundedRegExp.test(inferType(sink.observable))) {
            return;
        }

        let bufferRef = sink[bufferRefSymbol];
        if (!bufferRef) {
            bufferRef = sink[bufferRefSymbol] = {
                sink,
                sinkGraphRef: getGraphRef(sink),
                sinkSnapshotRef: getSnapshotRef(sink),
                sources: [],
                warned: false
            };
        }

        if (higherOrderRegExp.test(inferType(sink.observable))) {
            ref[bufferHigherOrderSymbol] = bufferRef;
        } else {
            bufferRef.sources.push(ref);
            ref[bufferRefSymbol] = bufferRef;
        }
    }
}
