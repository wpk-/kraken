'use strict';
import { useEffect, useState } from 'react';

export const useLocalStorage = (key, defaultValue = '') => {
  const [value, setValue] = useState(() => {
    return localStorage.getItem(key) || defaultValue;
  });

  useEffect(() => {
    // storing input name
    localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue];
};
