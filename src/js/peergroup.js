'use strict';
/**
 * Usage:
 * ------
 * const ws = new WebSocket('wss://...')
 * const group = new PeerGroup(ws)
 * 
 * group.addEventListener('peerjoin', ({peer}) => {
 * })
 * 
 * group.addEventListener('peerleave', ({peer}) => {
 * })
 * 
 * group.leave()
 * ws.close()
 *
 *
 * Protocol:
 * ---------
 * New user joins: {hi: 'new id'}
 * Connect to user: {from: 'member id', to: 'new id', sdp: ...}
 * Negotiate users: {from: member 1 id', to: 'member 2 id', sdp: ...}
 *
 * Accepting new requests: wait random time and drop if another peer responded already.
 * RTCDataChannel.onopen confirms connection succeeded. Drop if unconfirmed after timeout.
 * Drop means, destroy the peer object and remove data channel from this.peers.
 *
 *
 * TODO:
 * - WebSocket message bundling.
 * - Bind to 'pageshow', 'pagehide', 'resume' and 'freeze' events to manage
 *   WebSocket and WebRTC connections.
 *
 *
 * Page unload, pagehide, freeze and WebSocket and WebRTC:
 * -------------------------------------------------------
 * "If your page is using any of these APIs [WebSocket, WebRTC and others], it's
 * best to always close connections and remove or disconnect observers during
 * the pagehide or freeze event. That will allow the browser to safely cache the
 * page without the risk of it affecting other open tabs.
 *
 * Then, if the page is restored from the bfcache, you can re-open or re-connect
 * to those APIs (in the pageshow or resume event)."
 *
 * Source (25 Aug 2023): https://web.dev/bfcache/
 *
 */
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;

const CHANNEL_CONNECTING = 'connecting';
const CHANNEL_OPEN = 'open';
const CHANNEL_CLOSING = 'closing';
const CHANNEL_CLOSED = 'closed';

function isValidId(id) {
  const reUUIDv4 = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  return typeof id === 'string' && reUUIDv4.test(id);
}

/**
 * Provides fully-connected peer-to-peer group communication over WebRTC.
 * Out-of-band session negotiation is handled on a web socket.
 * When the web socket connection closes, the instance unbinds all referenecs,
 * making it available for garbage collection.
 *
 * Conceptually, the class comprises two parts: One part handles the web socket
 * communication to discover and announce new peers and flag incoming requests
 * for connection negotiation. The other part manages the pool of connected
 * peers with their WebRTC connections and dispatches events as peer connections
 * are established / terminated.
 * The two parts work quite separate from eachother. Only on incoming requests
 * for negotiation will the first part trigger `_handlePeer` to configure/set-up
 * the peer connection. And only when a local peer connection needs negotiation,
 * the second part invokes `negotiate` to send new parameters over the web
 * socket to the remote party.
 *
 * Events:
 * - 'peerjoin' ({ detail: { peer } })
 * - 'peerleave' ({ detail: { peer } })
 *
 * Methods:
 * - addPeer (remoteId, description)
 * - getPeer (remoteId)
 * - leave ()
 * - negotiate (remoteId, {candidate, description })
 * - removePeer (remoteId)
 * - send (messageObject)
 *
 * Properties:
 * - localId: String
 * - peers: [PeerConnection]
 * - socket: WebSocket
 *
 * Errors (and their remedies):
 * > Receive non-JSON message from the web socket.
 *   Probably telling us we've reached our message quota.
 *   -> `alert(data)`
 * > Web socket send fails because the connection is closed.
 *   Probably due to navigation, reload, laptop close, ...
 *   PeerGroup is not responsible for the web socket.
 *   -> Give messages a TTL of 60 seconds.
 *      socket 'open' on time? -> send the queued messages.
 *      message expired? -> remove from queue. log a message.
 * > The sending a message fails (to some peers).
 *   There is some time between accepting the peer connection -- where it is
 *   added to the list of peers -- and the data channel being open. Calling
 *   `send` right in between those moments invokes `peer.send` while its data
 *   channel is not ready yet, hence throwing an error.
 *   -> Since the peer has not "officially" joined yet, just ignore the error
 *      and skip sending the message to that peer.
 */
export class PeerGroup extends EventTarget {
  #_socket;

  constructor(config) {
    super();

    const { localId, peerConfig, socket } = config ?? {};

    this.localId = localId ?? self.crypto.randomUUID();
    this.peerConfig = peerConfig;
    this.socket = socket ?? null;

    this.peers = [
      // PeerConnection
    ];
  }

  /**
   * Setting `.socket` automatically attaches all event handlers.
   * Setting `.socket` to null then removes the event handlers.
   * Usually there is no need to do the latter though: `PeerGroup` binds to
   * the socket 'close' event to do that automatically. So just making sure to
   * close your web socket when done.
   */
  get socket() {
    return this.#_socket;
  }
  set socket(value) {
    let ws = this.#_socket;

    if (ws) {
      ws.removeEventListener('close', this._handleSocketStateChange);
      ws.removeEventListener('message', this._handleSocketMessage);
      ws.removeEventListener('open', this._handleSocketStateChange);

      this.#_socket = null;
    }

    if (value) {
      this.#_socket = ws = value;

      ws.addEventListener('close', this._handleSocketStateChange);
      ws.addEventListener('message', this._handleSocketMessage);
      ws.addEventListener('open', this._handleSocketStateChange);

      if (ws.readyState === SOCKET_OPEN) {
        // We missed the 'open' event, so trigger manually.
        this._handleSocketStateChange();
      }
    }
  }

  /**
   * Sends (a proposal for) connection parameters to the remote party.
   *
   * `params` is an object holding either one of two possible keys. Pass
   * `params.candidate` to send over an ICE candidate, or pass
   * `params.description` to send an SDP offer/answer.
   */
  negotiate(remoteId, params) {
    const { localId } = this; // , socket } = this;
    const { candidate, description } = params ?? {};
    const message = { from: localId, to: remoteId, candidate, description };
    // const msgJSON = JSON.stringify(message);
    // 
    // try {
    //   socket.send(msgJSON);
    // } catch (err) {
    //   console.error('ERROR SENDING WEBSOCKET MESSAGE', err, socket?.readyState);
    // }

    this._outbox.push(message)

    if (this._outbox.length === 1) {
      this._outboxTimeout = setTimeout(this._sendOutbox, 100)
    }
  }

  _outbox = []

  _sendOutbox = () => {
    const socket = this.socket

    const messages = this._outbox
    this._outbox = []

    const msgJSON = JSON.stringify(messages)
    
    try {
      socket.send(msgJSON);
    } catch (err) {
      console.error('ERROR SENDING WEBSOCKET MESSAGE', err, socket?.readyState);
    }
  }

  /**
   * Handles 'open' and 'close' events from the `WebSocket`.
   *
   * On open, it announces our presence on the web socket, inviting all present
   * parties to initiate a peer connection to us.
   *
   * On close, it removes all event handlers and our reference to the web
   * socket. Notably, it leaves all peer connections intact, allowing code to
   * offer a smooth experience while restoring the lost connection. To actually
   * leave the entire peer group, use `leave`.
   */
  _handleSocketStateChange = () => {
    const socket = this.socket;

    switch (socket?.readyState) {
      case SOCKET_OPEN:
        // `negotiate()` is identical to `negotiate(undefined, undefined)`,
        // resulting in a broadcast message to all peers on the web socket.
        this.negotiate();
        break;
      case SOCKET_CLOSED:
      case SOCKET_CLOSING:
        // Setting the socket to null triggers the clean-up.
        this.socket = null;
        break;
    }
  };

  /**
   * Handles 'message' events from the `WebSocket`.
   *
   * The message will only be handled if
   * - the received message is a broadcast message (`msg.to` is `undefined`), or
   * - the received message is directed to us (`msg.to === this.localId`).
   *
   * The message provides a sender (`msg.to`) and may provide peer connection
   * parameters. The request will be further handled by `_handlePeer`.
   */
  _handleSocketMessage = ({ data }) => {
    // const message = {};
    let messages = []

    // When the message can't be parsed we've probably hit a rate limit.
    // Inform the user with a popup.

    try {
      // Object.assign(message, JSON.parse(data));
      messages = JSON.parse(data)
    } catch (err) {
      console.error(err);
      alert(data);
      return;
    }

    const {localId} = this
    const handleMessage = ({ from, to, candidate, description }) => {  
      if ((to ?? localId) === localId && isValidId(from)) {
        this._handlePeer(from, { candidate, description });
      }
    }

    messages.forEach(handleMessage)
  };

  /**
   * Connects to the peer (`WebRTC`) and adds it to our pool of peers.
   *
   * Prints a warning and cancels the operation when a connection to another
   * peer with the same remote ID exists.
   */
  addPeer(remoteId, description) {
    if (this.findPeer(remoteId)) {
      console.warn('Remote ID collision when adding peer:', remoteId);
      return;
    }

    const { localId, peerConfig, peers } = this;
    const config = { peerConfig, description };
    const peer = new PeerConnection(localId, remoteId, config);

    peer.addEventListener('close', this._handlePeerStateChange);
    peer.addEventListener('message', this._handlePeerMessage);
    peer.addEventListener('negotiate', this._handlePeerNegotiation);
    peer.addEventListener('open', this._handlePeerStateChange);

    this.peers = [...peers, peer];
  }

  /**
   * Returns the `PeerConnection` instance for the given `remoteId`.
   * Returns `undefined` if the peer cannot be found.
   */
  getPeer(remoteId) {
    return this.peers.find(({ remoteId: id }) => id === remoteId);
  }

  /**
   * Joins the peer group, which is backed for out-of-band communication by
   * the given web socket.
   */
  join(socket) {
    this.socket = socket;
  }

  /**
   * Closes all peer connections and detaches from the web socket.
   * This effectively prepares for garbage collection. You should still close
   * the web socket.
   */
  leave() {
    this.peers.forEach((peer) => peer.close());
    this.peers = [];
    this.socket = null;
  }

  /**
   * Disconnects from the given peer and removes it from our pool.
   */
  removePeer(remoteId) {
    const peer = this.getPeer(remoteId);

    if (peer) {
      peer.removeEventListener('close', this._handlePeerStateChange);
      peer.removeEventListener('message', this._handlePeerMessage);
      peer.removeEventListener('negotiate', this._handlePeerNegotiation);
      peer.removeEventListener('open', this._handlePeerStateChange);

      peer.close();

      this.peers = this.peers.filter((p) => p !== peer);
    }
  }

  /**
   * Sends a message (string) to all peers in the group.
   */
  send(msgString) {
    console.debug(`Group SEND: ${msgString}`);

    this.peers.forEach((peer) => peer.send(msgString));
  }

  /**
   * Accepts an incoming connection (negotiation) request.
   * If the peer is not in our list yet, it is added there.
   */
  _handlePeer = (remoteId, { candidate, description }) => {
    const peer = this.getPeer(remoteId);

    if (peer) {
      peer.negotiate({ candidate, description });
    } else {
      this.addPeer(remoteId, description);
    }
  };

  /**
   * Handles 'message' events from the `RTCDataChannel`.
   * It simply forwards the event, adding a reference to the peer that sent the
   * message in `event.peer`. Also `event.target` is now the `PeerGroup`.
   */
  _handlePeerMessage = ({ target: peer, data }) => {
    const event = new MessageEvent('message', { data });
    event.peer = peer;

    this.dispatchEvent(event);
  };

  /**
   * Handles 'negotiate' events from the `PeerConnection`.
   * Forwards the (proposed) connection parameters to the peer.
   */
  _handlePeerNegotiation = ({ target: peer, detail: params }) => {
    this.negotiate(peer.remoteId, params);
  };

  /**
   * Handles 'open' and 'close' events from the `PeerConnection`.
   *
   * The open event means the peer connection is established. The `PeerGroup`
   * dispatches a 'peerjoin' event with the `PeerConnection` instance in
   * `event.detail.peer`.
   *
   * When the peer connection closes, it is removed from our list and a
   * 'peerleave' event is dispatched with a reference to it in
   * `event.detail.peer`.
   */
  _handlePeerStateChange = ({ target: peer, type }) => {
    let event = null;

    switch (type) {
      case 'open':
        event = new CustomEvent('peerjoin', { detail: { peer } });
        break;
      case 'close':
        this.removePeer(peer.remoteId);
        event = new CustomEvent('peerleave', { detail: { peer } });
        break;
      default:
        return;
    }

    this.dispatchEvent(event);
  };
}

/**
 * A data channel over WebRTC between this local side and a remote.
 * It handles most of the negotiation but needs a back-channel to carry
 * out-of-band session negotiation messages to the remote.
 *
 * Events:
 * - 'close' ()
 * - 'message' ({ data })
 * - 'negotiate' ({ candidate, description })
 * - 'open' ()
 *
 * Methods:
 * - close ()
 * - negotiate ({ candidate, description })
 * - send (messageString)
 *
 * Properties:
 * - channel: RTCDataChannel
 * - connection: RTCPeerConnection
 * - localId: String
 * - readyState: String (= channel.readyState)
 * - remoteId: String
 */
export class PeerConnection extends EventTarget {
  constructor(localId, remoteId, config) {
    super();

    const { peerConfig, description } = config ?? {};

    this.localId = localId;
    this.remoteId = remoteId;

    this._ignoreOffer = false;
    this._makingOffer = false;
    this._polite = localId > remoteId;

    this.connection = null;
    this.channel = null;

    const pc = new RTCPeerConnection(peerConfig);
    this.setConnection(pc, description);
  }

  get readyState() {
    return this.channel?.readyState;
  }

  /**
   * Unbinds, closes and removes both data channel and peer connection.
   */
  close() {
    this.closeDataChannel();
    this.closeConnection();
  }

  /**
   * Closes the `RTCPeerConnection`.
   * It removes all event handlers and references and closes the connection.
   */
  closeConnection() {
    const pc = this.connection;

    if (!pc) {
      return;
    }

    pc.removeEventListener('datachannel', this._handleDataChannel);
    pc.removeEventListener('icecandidate', this._handleIceCandidate);
    pc.removeEventListener('iceconnectionstatechange', this._handleStateChange);
    pc.removeEventListener('negotiationneeded', this._handleNegotiationNeeded);

    pc.close();

    this.connection = null;
  }

  /**
   * Closes the `RTCDataChannel`.
   * It removes all event handlers and references and closes the channel.
   */
  closeDataChannel() {
    const dc = this.channel;

    if (!dc) {
      return;
    }

    dc.removeEventListener('closing', this._handleDataChannelStateChange);
    dc.removeEventListener('message', this._handleDataChannelMessage);
    dc.removeEventListener('open', this._handleDataChannelStateChange);

    dc.close();

    this.channel = null;
  }

  /**
   * Configures the peer connection.
   * It applies the ICE candidate or session description. In doing so, more
   * proposals may be generated (to be delivered out-of-band).
   *
   * The implementation follows the "perfect negotiation" logic for setting
   * up peer-to-peer RTC connections.
   */
  async negotiate({ candidate, description }) {
    const { connection, _ignoreOffer, _makingOffer, _polite } = this;

    try {
      if (description) {
        const offerCollision =
          description.type === 'offer' &&
          (_makingOffer || connection.signalingState !== 'stable');

        this._ignoreOffer = !_polite && offerCollision;

        if (this._ignoreOffer) {
          return;
        }

        await connection.setRemoteDescription(description);
        if (description.type === 'offer') {
          await connection.setLocalDescription();
          this.sendOutOfBand({ description: connection.localDescription });
        }
      } else if (candidate) {
        try {
          await connection.addIceCandidate(candidate);
        } catch (err) {
          if (!_ignoreOffer) {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Sends a message to the remote party over the data channel.
   * To avoid repeated JSON stringification the argument is a string and
   * not an object.
   */
  send(msgString) {
    console.info(`SEND to peer ${this.remoteId}: ${msgString}.`);

    this.channel.send(msgString);
  }

  /**
   * Emits a 'negotiate' event with data to be sent to the remote party.
   * The data needs to be delivered out-of-band.
   *
   * `event.detail = { candidate, description }`
   * `event.target = this`
   */
  sendOutOfBand({ candidate, description }) {
    const detail = { candidate, description };
    const event = new CustomEvent('negotiate', { detail });

    this.dispatchEvent(event);
  }

  /**
   * Configures and stores the RTCPeerConnection.
   * It adds event handlers and stores a reference to the connection.
   * Use `closeConnection` to close the connection and remove it.
   *
   * `description` may contain an initial session description (SDP) offer.
   */
  setConnection(pc, description) {
    if (this.connection) {
      this.closeConnection();
    }

    this.connection = pc;

    pc.addEventListener('icecandidate', this._handleIceCandidate);
    pc.addEventListener('iceconnectionstatechange', this._handleIceStateChange);
    pc.addEventListener('negotiationneeded', this._handleNegotiationNeeded);

    // If there IS NO initial offer, it means someone else just entered the room
    // (socket). We then CREATE the data channel and it will kick off the
    // negotiation.
    // If, on the other hand, there IS an offer, it means there is a data
    // channel and we should LISTEN for this channel to come in. In the meantime
    // we configure the peer connection using the provideed session description.

    if (description) {
      pc.addEventListener('datachannel', this._handleDataChannel);
      this.negotiate({ description });
    } else {
      this._handleDataChannel({ channel: pc.createDataChannel('ILOVEYOU') });
    }
  }

  /**
   * Configures and stores the RTCDataChannel.
   * It stores a reference to the channel and adds event handlers.
   * Use `closeDataChannel` to close the channel and remove it.
   */
  setDataChannel(dc) {
    if (this.channel) {
      this.closeDataChannel();
    }

    this.channel = dc;

    dc.addEventListener('closing', this._handleDataChannelStateChange);
    dc.addEventListener('message', this._handleDataChannelMessage);
    dc.addEventListener('open', this._handleDataChannelStateChange);
  }

  /**
   * Handles 'message' events from the `RTCDataChannel`.
   * It simply forwards the event but reassigns its target to be the
   * `PeerConnection`, which makes the interface feel more natural.
   */
  _handleDataChannelMessage = ({ data }) => {
    const event = new MessageEvent('message', { data });
    this.dispatchEvent(event);
  };

  /**
   * Handles 'open' and 'closing' events from the `RTCDataChannel`.
   *
   * On 'closing', the whole peer connection is closed and cleaned so that the
   * instance can be garbage collected.
   *
   * Dispatches new events, 'open' and 'close' with `event.target` equal to the
   * `PeerConnection` instance.
   */
  _handleDataChannelStateChange = ({ type }) => {
    console.debug('PeerConnection._handleDataChannelStateChange:', type);

    switch (type) {
      // case 'close':
      case 'closing':
        // We've lost the data channel. Do away with the whole peer connection.
        this.close();
        this.dispatchEvent(new CustomEvent('close'));
        break;
      case 'open':
        this.dispatchEvent(new CustomEvent('open'));
        break;
    }
  };

  /**
   * Handles 'datachannel' events from the `RTCPeerConnection`.
   * It configures and stores the data channel.
   */
  _handleDataChannel = ({ channel }) => {
    if (!this.channel) {
      this.setDataChannel(channel);
    } else {
      console.warn('Cannot set multiple data channels.');
    }
  };

  /**
   * Handles 'icecandidate' events from the `RTCPeerConnection`.
   * It calls `sendOutOfBand` to request out-of-band delivery of the new ICE
   * candidate.
   */
  _handleIceCandidate = ({ candidate }) => {
    if (candidate) {
      this.sendOutOfBand({ candidate });
    }
  };

  /**
   * Handles 'negotiationneeded' events from the `RTCPeerConnection`.
   * It follows the "perfect negotiation" protocol to set up the peer-to-peer
   * connection with the remote party.
   */
  _handleNegotiationNeeded = async () => {
    // this = PeerConnection
    const pc = this.connection;

    try {
      this._makingOffer = true;
      await pc.setLocalDescription();
      this.sendOutOfBand({ description: pc.localDescription });
    } catch (err) {
      // Possible errors:
      // - peer is undefined (not found)
      // - setLocalDescription fails (incompatibility with other peers)
      // - sendNegotiation fails (e.g. socket closed)
      console.error(err);
    } finally {
      this._makingOffer = false;
    }
  };

  /**
   * Handles 'iceconnectionstatechange' events from the `RTCPeerConnection`.
   * In particular, if an ICE connection failed, it restarts it.
   */
  _handleStateChange = () => {
    // this = PeerConnection
    const pc = this.connection;

    if (pc.iceConnectionState === 'failed') {
      pc.restartIce();
    }
  };
}

export function main({ localId, peerConfig, connect }) {
  localId = localId ?? self.crypto.randomUUID();
  peerConfig = peerConfig ?? PEER_DEFAULT_CONFIG;

  const group = new PeerGroup(socket, { localId, peerConfig });

  group.addEventListener('join', ({ detail }) => {
    const { peer } = detail;
    const groupSize = group.peers.length + 1;
    group.send(`Hi group, lets all welcome our new member, ${peer.remoteId}!`);
    peer.send(`Welcome! With you in here that makes ${groupSize} of us.`);
  });

  group.addEventListener('leave', ({ detail }) => {
    const { peer } = detail;
    const groupSize = group.peers.length + 1;
    group.send(`We've lost ${peer.remoteId}. Now down to ${groupSize}.`);
  });

  group.addEventListener('message', (event) => {
    const { peer, data } = event;
    console.log(`${peer.remoteId} says: "${data}" (but that could be a lie.)`);
  });
}
