'use strict';

export const connect = (apiKey = 'demo', channel = 1) =>
  new WebSocket(`wss://socketsbay.com/wss/v2/${channel}/${apiKey}/`);
