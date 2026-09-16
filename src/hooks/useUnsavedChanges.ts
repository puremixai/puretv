'use client';
import { useEffect, useId } from 'react';
const dirtyPanels = new Set<string>();
export function hasUnsavedChanges() {
  return dirtyPanels.size > 0;
}
export function confirmDiscardChanges() {
  return (
    dirtyPanels.size === 0 ||
    window.confirm('有未保存的更改，离开会丢失这些内容。仍要继续吗？')
  );
}
const unload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  event.returnValue = '';
};
const navigate = (event: MouseEvent) => {
  const target = event.target;
  const link = target instanceof Element ? target.closest('a[href]') : null;
  if (
    event.defaultPrevented ||
    !link ||
    link.getAttribute('target') === '_blank' ||
    link.getAttribute('href')?.startsWith('#')
  )
    return;
  if (!confirmDiscardChanges()) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
};
export function useUnsavedChanges(dirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    if (dirtyPanels.size === 0) {
      window.addEventListener('beforeunload', unload);
      document.addEventListener('click', navigate, true);
    }
    dirtyPanels.add(id);
    return () => {
      dirtyPanels.delete(id);
      if (dirtyPanels.size === 0) {
        window.removeEventListener('beforeunload', unload);
        document.removeEventListener('click', navigate, true);
      }
    };
  }, [dirty, id]);
}
