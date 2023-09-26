'use strict';
import { useEffect, useState } from 'react';

/**
 * Creates a connection and returns an interface to send and
 * receive JSON messages. It returns two state variables,
 * `lastMessage` and `readyState`, and a method `sendMessage`.
 *
 * factory is a function that returns a new connection.
 *
 * Future work:
 * We could easily introduce a `reconnectionCount` state
 * variable and make `useEffect` dependent on that. Increment
 * the counter whenever `readyState === 2` and the whole thing
 * automagically reconnects.
 */
export function useConnection(factory) {
  const empty = () => {};

  const [lastMessage, setLastMessage] = useState({});
  const [readyState, setReadyState] = useState(0);
  const [sendMessage, setSendMessage] = useState(() => empty);

  // The two event handlers do not depend on the connection
  // and are therefore declared outside `useEffect`.

  const handleMessage = ({ data }) => {
    const message = JSON.parse(data);
    setLastMessage(message);
  };

  const handleReadyStateChange = (e) => {
    setReadyState(e.target.readyState);
  };

  // The effect, setting up and tearing down the connection,
  // depends on the factory.

  useEffect(() => {
    let conn = null;

    const connect = () => {
      console.log('✅ Connecting...');
      conn = factory();
      conn.addEventListener('open', handleReadyStateChange);
      conn.addEventListener('close', handleReadyStateChange);
      conn.addEventListener('error', handleReadyStateChange);
      conn.addEventListener('message', handleMessage);
      setSendMessage(() => send);
    };

    const disconnect = () => {
      console.log('❌ Disconnecting...');
      conn.removeEventListener('open', handleReadyStateChange);
      conn.removeEventListener('close', handleReadyStateChange);
      conn.removeEventListener('error', handleReadyStateChange);
      conn.removeEventListener('message', handleMessage);

      // Avoid an error message in the console saying:
      // "WebSocket is closed before the connection is established."

      switch (conn.readyState) {
        case 0:
          // Use e.target because conn will be null.
          conn.addEventListener('open', (e) => e.target.close());
          break;
        case 1:
          conn.close();
          break;
      }
      setSendMessage(() => empty);
      setReadyState(conn.readyState);
      conn = null;
    };

    const send = (subject, sender, recipient, body) => {
      if (conn) {
        const message = { subject, from: sender, to: recipient, body };
        const msgJSON = JSON.stringify(message);
        conn.send(msgJSON);
      }
    };

    connect();

    return disconnect;
  }, [factory]);

  return { lastMessage, readyState, sendMessage };
}
