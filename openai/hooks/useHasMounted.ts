import { useEffect, useRef, useState } from "react";

/**
 * useHasMounted
 * Returns `true` only after the component has been mounted on the client.
 * Useful to avoid HTML mismatches between SSR and CSR when reading
 * browser-only APIs (localStorage, window, etc.).
 */
export default function useHasMounted(): boolean {
  const [hasMounted, setHasMounted] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Only run once
    if (!mountedRef.current) {
      mountedRef.current = true;
      setHasMounted(true);
    }
  }, []);

  return hasMounted;
}
