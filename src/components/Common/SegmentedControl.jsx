import { useRef } from 'react';
import './SegmentedControl.css';

export default function SegmentedControl({
  value,
  options,
  onChange,
  label,
  size = 'medium',
  className = '',
}) {
  const refs = useRef([]);

  function moveFocus(event, index) {
    const rtl = document.documentElement.dir === 'rtl' || document.body.dir === 'rtl';
    const previousKey = rtl ? 'ArrowRight' : 'ArrowLeft';
    const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight';
    let nextIndex = index;
    if (event.key === previousKey) nextIndex = (index - 1 + options.length) % options.length;
    else if (event.key === nextKey) nextIndex = (index + 1) % options.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[nextIndex];
    if (!option?.disabled) {
      onChange(option.value);
      refs.current[nextIndex]?.focus();
    }
  }

  return (
    <div className={`segmented-control segmented-control--${size} ${className}`.trim()} role="group" aria-label={label}>
      {options.map((option, index) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={element => { refs.current[index] = element; }}
            type="button"
            className={active ? 'segmented-control__option segmented-control__option--active' : 'segmented-control__option'}
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={event => moveFocus(event, index)}
          >
            {Icon && <Icon size={option.iconSize || 16} aria-hidden="true" />}
            <span>{option.label}</span>
            {Number.isInteger(option.count) && option.count > 0 && <span className="segmented-control__count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
