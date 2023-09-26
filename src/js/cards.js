'use strict';
// The four suits: spades, hearts, clubs, diamonds.
export const suits = '♠♥♣♦';
// The eight ranks: 7, 8, 9, 10, Jack, Queen, King, Ace.
export const ranks = '789TJQKA';
// 789TJQKA for each of the four suits in order.
// Each card is composed of 2 unicode characters. All methods that deal with the
// cards in the deck therefore multiply and divide indices by a factor 2.
export const deck = '🂧🂨🂩🂪🂫🂭🂮🂡🂷🂸🂹🂺🂻🂽🂾🂱🃗🃘🃙🃚🃛🃝🃞🃑🃇🃈🃉🃊🃋🃍🃎🃁';
// The card back.
export const back = '🂠';

/**
 * Returns the card (string character) for its index in the sorted deck.
 */
export function card(index) {
  return deck.substring(index << 1, (index << 1) + 2);
}

/**
 * Returns the card's index in a sorted deck.
 */
export function sortedPosition(card) {
  return deck.indexOf(card);
}

/**
 * Returns the suit (string character) for the card (string character).
 */
export function suit(card) {
  return suits[deck.indexOf(card) >> 4];
}

/**
 * Returns the rank (string character) for the card (string character).
 */
export function rank(card) {
  return ranks[deck.indexOf(card) % 16 >> 1];
}

/**
 * Shuffles the deck and returns four hands of eight cards in sorted order.
 * The return value is an array of four arrays, each holding eight string
 * characters (cards).
 */
export function deal() {
  const cards_ix = Array(32)
    .fill(0)
    .map((_, i) => i);
  shuffleArray(cards_ix);

  const hands = [0, 1, 2, 3].map((i) => {
    const hand_ix = cards_ix.slice(i * 8, i * 8 + 8);
    hand_ix.sort((a, b) => a - b);
    return hand_ix.map(card);
  });

  return hands;
}

export function dealByAssignment() {
  const eightTimes = (i) => Array(8).fill(i);
  const ixPlayer = [0, 1, 2, 3].map(eightTimes).flat();
  shuffleArray(ixPlayer);
  return ixPlayer;
}

/**
 * Shuffles the array in place.
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
