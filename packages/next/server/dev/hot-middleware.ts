// Based on https://github.com/webpack-contrib/webpack-hot-middleware/blob/9708d781ae0e46179cf8ea1a94719de4679aaf53/middleware.js
// Included License below

// Copyright JS Foundation and other contributors

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// 'Software'), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
// CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import { webpack } from 'next/dist/compiled/webpack/webpack'
import type ws from 'ws'

export class WebpackHotMiddleware {
  eventStream: EventStream
  latestStats: webpack.Stats | null
  clientLatestStats: webpack.Stats | null
  closed: boolean
  serverError: boolean

  constructor(compilers: webpack.Compiler[]) {
    this.eventStream = new EventStream()
    this.latestStats = null
    this.clientLatestStats = null
    this.serverError = false
    this.closed = false

    compilers[0].hooks.invalid.tap(
      'webpack-hot-middleware',
      this.onClientInvalid
    )
    compilers[0].hooks.done.tap('webpack-hot-middleware', this.onClientDone)

    compilers[1].hooks.invalid.tap(
      'webpack-hot-middleware',
      this.onServerInvalid
    )
    compilers[1].hooks.done.tap('webpack-hot-middleware', this.onServerDone)
  }

  onServerInvalid = () => {
    if (!this.serverError) return

    this.serverError = false

    if (this.clientLatestStats) {
      this.latestStats = this.clientLatestStats
      this.publishStats('built', this.latestStats)
    }
  }
  onClientInvalid = () => {
    if (this.closed || this.serverError) return
    this.latestStats = null
    this.eventStream.publish({ action: 'building' })
  }
  onServerDone = (statsResult: webpack.Stats) => {
    if (this.closed) return
    // Keep hold of latest stats so they can be propagated to new clients
    // this.latestStats = statsResult
    // this.publishStats('built', this.latestStats)
    this.serverError = statsResult.hasErrors()

    if (this.serverError) {
      this.latestStats = statsResult
      this.publishStats('built', this.latestStats)
    }
  }
  onClientDone = (statsResult: webpack.Stats) => {
    this.clientLatestStats = statsResult

    if (this.closed || this.serverError) return
    // Keep hold of latest stats so they can be propagated to new clients
    this.latestStats = statsResult
    this.publishStats('built', this.latestStats)
  }

  onHMR = (client: ws) => {
    if (this.closed) return
    this.eventStream.handler(client)
    if (this.latestStats) {
      // Explicitly not passing in `log` fn as we don't want to log again on
      // the server
      this.publishStats('sync', this.latestStats)
    }
  }

  publishStats = (action: string, statsResult: webpack.Stats) => {
    const stats = statsResult.toJson({
      all: false,
      hash: true,
      warnings: true,
      errors: true,
    })

    this.eventStream.publish({
      action: action,
      hash: stats.hash,
      warnings: stats.warnings || [],
      errors: stats.errors || [],
    })
  }

  publish = (payload: any) => {
    if (this.closed) return
    this.eventStream.publish(payload)
  }
  close = () => {
    if (this.closed) return
    // Can't remove compiler plugins, so we just set a flag and noop if closed
    // https://github.com/webpack/tapable/issues/32#issuecomment-350644466
    this.closed = true
    this.eventStream.close()
  }
}

class EventStream {
  clients: Set<ws>
  constructor() {
    this.clients = new Set()
  }

  everyClient(fn: (client: ws) => void) {
    for (const client of this.clients) {
      fn(client)
    }
  }

  close() {
    this.everyClient((client) => {
      client.close()
    })
    this.clients.clear()
  }

  handler(client: ws) {
    this.clients.add(client)
    client.addEventListener('close', () => {
      this.clients.delete(client)
    })
  }

  publish(payload: any) {
    this.everyClient((client) => {
      client.send(JSON.stringify(payload))
    })
  }
}
