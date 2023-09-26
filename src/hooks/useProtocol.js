'use strict';
import peer from '../external/peer.js';
import { useEffect, useState } from 'react';

export function useClientProtocol({ lastMessage, readyState, sendMessage }) {
  // internal:
  //  * set & keep "clientId"
  //  * when readyState == 1, call "sayHi()"
  //  * "negotiate()" -> use client ID and stored room ID
  //
  // external:
  //  * when receive "welcome", update "lastRoom".
  //  * "joinRoom/setRoomId()" -> store joined room ID. Launch a WebRTC connection. Return a factory for pc.createDataConnection.
  //

  const [clientId] = useState(self.crypto.randomUUID());
  const [roomId, setRoomId] = useState(null);

  const [lastAnnouncedRoom, setLastAnnouncedRoom] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);

  useEffect(() => {
    const { subject, from: sender, to: recipient, body } = lastMessage;

    if (readyState !== 1) {
      return;
    }

    switch (subject) {
      case 'welcome':
        const room = { id: from, users: body.users };
        setLastAnnouncedRoom(room);
        break;
      case 'negotiate':
        // ...
        break;
    }
  }, [lastMessage]);

  // useEffect(() => {
  //   // ...
  // }, [readyState]);

  function connect() {}
}
