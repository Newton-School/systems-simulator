import { createWorkerController } from './simulationWorkerController'
import type { WorkerInboundMessage, WorkerOutboundMessage } from './protocols'

// Thin wiring: all behaviour (chunked/paced execution, validation, stop, step,
// set-speed) lives in simulationWorkerController.ts so it can be tested in Node.
// The message contract is documented in protocols.ts.
const controller = createWorkerController({
  post: (msg: WorkerOutboundMessage) => self.postMessage(msg)
})

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  controller.handleMessage(event.data)
}
