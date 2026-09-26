'use client';

import { useState } from 'react';

// For a card whose parent only knows "this card is busy": remembers which of
// the card's buttons was pressed, so that one alone shows its pending label,
// and `pressed` says where the outcome message belongs.
//   const { press, pendingFor } = usePressedAction(isPending);
//   <ActionButton onClick={press('done', () => onStatus(item, 'done'))} pending={pendingFor('done')} …>
export function usePressedAction(busy) {
  const [pressed, setPressed] = useState('');
  return {
    pressed,
    reset: () => setPressed(''),
    press: (key, action) => (...args) => {
      setPressed(key);
      return action(...args);
    },
    pendingFor: (key) => Boolean(busy) && pressed === key,
  };
}
