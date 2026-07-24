import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export const render = async (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | undefined;

  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
};

export const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

export const submit = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
};

export const change = async (element: Element, value: string | boolean) => {
  await act(async () => {
    if (element instanceof HTMLInputElement && typeof value === 'boolean') {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'checked',
      )?.set;
      setter?.call(element, value);
    } else if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement
    ) {
      const prototype =
        element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLSelectElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(element, String(value));
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
