import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * STATE
 * -----
 * 32 cards
 * 4 players
 * 1 table
 *
 * Each player can hold cards in 3 places:
 *  - in their hand,
 *  - open on the table (one card at a time),
 *  - on their stack of tricks won (closed but publicly known).
 *
 * Each card can thus be in one of 12 places.
 * = 32 x 12 binary matrix.
 *
 * Each player can meld
 *  - once in hand (max 300). only the team with the highest meld is awarded their points.
 *    This meld is accompanied by
 *     - a number 1..13 indicating the highest card,
 *     - a binary flag indicating if the player/team is awarded the points.
 *  - on each turn on the table (awarded to trick winning player, added to their previous meld)
 *  - once king and queen of trump suit (either in hand or awarded to trick winning player, it
 *    is awarded in either case).
 *
 * There are in total 3 numbers of meld per player, plus a card indicator and an awarded flag.
 * = 4 x 5 numeric matrix.
 *
 * Game state indicators.
 * There is one trump, one led suit.
 * = 4 x 2 binary matrix.
 *
 * Useful extras:
 *
 * The cards can be of trump suit and of led suit. This can be stored as two binary arrays.
 * = 32 x 2 binary matrix.
 *
 * Given the trump suit, each card has a set value.
 * = 32 x 1 integer array.
 *
 * Actions
 *  - deal
 *  - make (name the trump suit)
 *  - meld in hand
 *  - play card
 *    - meld stuk
 *  - take the trick
 *    - meld on the table
 *  - claim opponent revoked
 *  - award round
 *  - end match
 *
 *
 *
 * We also store the game round history:
 * We add a sequence number counting the order in which cards are played (1..32) and the player
 * who played that card (4 x binary).
 * = 32 x 1 sequence array.
 * = 32 x 4 binary matrix.
 */

// import { connect as connectSB } from './js/socketsbay.js';
// import {PeerGroup} from './js/peergroup.js'

// import { useConnection } from './hooks/useConnection.js';
// import { useLocalStorage } from './hooks/useLocalStorage.js';
// import { rooms as storedRooms } from './data.js';
// import { keys, peerConfig } from './config.js';

import './style.css';

import { deal, back } from './js/cards.js';
// const connect = () => connectSB(keys.socketsBay, 1)

export default function App() {
  // const match = {
  //   players: ['wpk', 'left', 'mate', 'right'],
  // };
  // const round = {
  //   dealer: 1,
  //   declarer: 2,
  //   hands: deal(),
  // };
  // const trick = {
  //   leader: 1,
  //   inturn: 3,
  //   cards: [hands[1][1], hands[2][2]],
  // };

  /*
  1 match = 16 rounds
  1 round = 8 tricks
  1 trick = 4 cards

  - after a trick is over, the trick winner becomes the leader.
  - after a round is over, the declarer becomes the dealer and the next player becomes the declarer.
  - after declaring, the declarer becomes the leader.

  dealer = player who deals the cards.
  declarer = player who announces the trump suit.
  leader = plays the first card in a trick.
  inturn = player who is expected to play next.
  */

  return (
    <>
      <Card card="🂠" className="" />
      <Card card="🂥" className="h1-1" />
      {/* <Table cards={trick} />
      {hands.slice(1).map((hand, i) => (
        <Player
          key={i + 1}
          index={i + 1}
          name={players[i + 1].name}
          hand={hand}
          showCards={false}
          canPlay={false}
          turn={turn === i + 1}
        />
      ))}
      <Player
        key={0}
        index={0}
        name={players[0].name}
        hand={players[0].hand}
        showCards={true}
        canPlay={true}
        turn={turn === 0}
      /> */}
    </>
  );
  // After the table: action buttons.
  // After the action buttons: the score.
}

function Table({ cards }) {
  return (
    <div className="table">
      {cards.map((card) => (
        <Card key={card} card={card} />
      ))}
    </div>
  );
}

function Player({
  index,
  name,
  hand,
  showCards = false,
  canPlay = false,
  turn = false,
}) {
  return (
    <div className={`player player-${index}${turn ? ' turn' : ''}`}>
      <div className="player-name">{name}</div>
      <Hand cards={hand} open={showCards} playable={canPlay} />
    </div>
  );
}

function Hand({ cards, open = false, playable = false }) {
  return (
    <div className={`hand ${playable ? 'playable' : ''}`}>
      {cards.map((card) => (
        <Card key={card} card={open ? card : back} />
      ))}
    </div>
  );
}

function Card({ card, className = '', ...props }) {
  return (
    <div
      className={`card ${card} ${className}`}
      aria-label={card}
      {...props}
    ></div>
  );
}

/**
 * App
 *  - websocket: sendMessage, lastMessage, readyState
 *  Home
 *    LabelTextInput (playerName)
 *    RoomsList
 *      GamesList
 *      button (new game)
 *  Game
 *    ...
 */
// export default function App() {
//   const [clientId] = useState(() => self.crypto.randomUUID());
//   // NB. useMemo advised here: https://stackoverflow.com/a/67802751/2290493
//   const { lastMessage, readyState, sendMessage } = useConnection(connect);

//   const [playerName, setPlayerName] = useLocalStorage('name');
//   const [rooms, setRooms] = useState(storedRooms);
//   const [maxRooms] = useState(15);

//   // useEffect note: the code DOES depend on more variables than just
//   // lastMessage, e.g. rooms and setRooms. However, it SHOULDN'T rerun
//   // when any of those other variables change. The only time this
//   // effect should execute is when there actually is a new message.
//   // Hence, only lastMessage is in its list of dependencies.

//   useEffect(() => {
//     const { subject, from, to, body } = lastMessage;

//     switch (subject) {
//       case 'welcome':
//         const index = rooms.findIndex(({ id }) => id === from);
//         const room = { id: from, users: body.users };

//         if (index > -1) {
//           setRooms(rooms.toSpliced(index, 1, room));
//         } else if (room.users.length < 4) {
//           setRooms([room, ...rooms].slice(0, maxRooms));
//         } else if (rooms.length < maxRooms) {
//           setRooms([...rooms, room]);
//         }
//         break;
//       default:
//         console.debug('Ignore unknown message:', lastMessage);
//         return;
//     }
//   }, [lastMessage]);

//   useEffect(() => {
//     console.log('Ready state is', readyState);

//     if (readyState === 1) {
//       sendMessage('hi', clientId);
//     }
//   }, [readyState]);

//   return ();
// }
