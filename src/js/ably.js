'use strict';

export function connect(apiKey) {
  const FLAG_PUBLISH = 1 << 17;
  const FLAG_SUBSCRIBE = 1 << 18;

  const channel = 'kraken';
  const flags = FLAG_PUBLISH | FLAG_SUBSCRIBE;

  const msgJoin = JSON.stringify({ action: 10, channel });
  const msgFlags = JSON.stringify({ action: 10, channel, flags });

  let sentFlags = false;
  let msgSerial = 0;
  let connectionId = '';
  const handlers = [];

  const params = new URLSearchParams({
    key: apiKey,
    format: 'json',
    heartbeats: 'true',
    v: '1.2',
    agent: 'ably-js/1.2.20 browser',
  });
  const url = new URL(`?${params}`, 'wss://realtime.ably.io');

  const ws = new WebSocket(url);

  const adjustedReadyState = (rs) =>
    // Suppress readyState = 1 (OPEN) until we've sent the flags.
    // Until that time, readyState will remain 0 (or 2/3 for closing).
    ({ [rs]: rs, 1: sentFlags ? 1 : 0 }[rs]);

  const x = {
    readyState: ws.readyState,
    addEventListener(type, callback) {
      handlers.push([type, callback]);
    },
    removeEventListener(type, callback) {
      const index = handlers.findIndex(
        ([tp, cb]) => tp === type && cb === callback
      );
      if (index > -1) {
        handlers.splice(index, 1);
      }
    },
    send(strMessage) {
      const protocol = {
        action: 15,
        channel,
        msgSerial: ++msgSerial,
        count: 1,
        connectionId,
        messages: [{ name: 'kraken', data: strMessage }],
      };
      const msgJSON = JSON.stringify(protocol);
      console.log('NOT sending message:', protocol);
      //ws.send(msgJSON);
    },
    close() {
      ws.removeEventListener('open', stateHandler);
      ws.removeEventListener('close', stateHandler);
      ws.removeEventListener('error', stateHandler);
      ws.removeEventListener('message', messageHandler);
      ws.close();
      handlers.length = 0;
      sentFlags = false;
      msgSerial = 0;
      Array.from(Object.keys(x)).forEach((k) => delete x[k]);
    },
  };

  ws.addEventListener('open', stateHandler);
  ws.addEventListener('close', stateHandler);
  ws.addEventListener('error', stateHandler);
  ws.addEventListener('message', messageHandler);

  return x;

  function stateHandler(e) {
    const { target, type } = e;
    const evt = { target: x, type };

    x.readyState = adjustedReadyState(target.readyState);

    for (const [tp, callback] of handlers) {
      if (tp === type) {
        callback(evt);
      }
    }
  }

  function messageHandler(e) {
    const { target, type, data } = e;
    const protocol = JSON.parse(data);

    x.readyState = adjustedReadyState(target.readyState);

    switch (protocol.action) {
      case 0: // Heartbeat.
      case 1: // Acknowledge the sent message.
        break;
      case 4: // Connection is open.
        connectionId = protocol.connectionId;
        target.send(msgJoin);
        break;
      case 11: // Subscribed to channel.
        if (!sentFlags) {
          sentFlags = true;
          target.send(msgFlags);
        } else {
          stateHandler({ target, type: 'open' });
        }
        break;
      case 15: // Incoming message.
        protocol.messages.forEach(({ data }) => {
          const localEvent = { target: x, type, data };

          for (const [tp, callback] of handlers) {
            if (tp === type) {
              callback(localEvent);
            }
          }
        });
        break;
      default:
        console.log("Don't know how to handle message:", protocol);
        return;
    }
  }
}
