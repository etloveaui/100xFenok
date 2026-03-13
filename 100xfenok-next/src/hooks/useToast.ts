import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast(dismissMs = 2500) {
  const [message, setMessage] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setMessage(text);
    setIsVisible(true);
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      timeoutRef.current = null;
    }, dismissMs);
  }, [dismissMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { show, message, isVisible };
}
