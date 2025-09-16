/**
 * Shadcn/UI Utility Functions for Vanilla JavaScript
 * Replaces clsx and tailwind-merge functionality
 */

/**
 * Combines class names conditionally (clsx replacement)
 * @param {...any} inputs - Class names, objects, arrays, etc.
 * @returns {string} Combined class names
 */
export function clsx(...inputs) {
  const classes = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string') {
      classes.push(input);
    } else if (Array.isArray(input)) {
      const nested = clsx(...input);
      if (nested) classes.push(nested);
    } else if (typeof input === 'object') {
      for (const [key, value] of Object.entries(input)) {
        if (value) classes.push(key);
      }
    }
  }

  return classes.join(' ');
}

/**
 * Merges Tailwind CSS classes intelligently (tailwind-merge replacement)
 * Removes conflicting classes and keeps the last one
 * @param {string} classes - Space-separated class names
 * @returns {string} Merged class names
 */
export function twMerge(classes) {
  if (!classes) return '';

  const classArray = classes.split(' ').filter(Boolean);
  const classMap = new Map();

  // Define conflicting class groups
  const conflictGroups = {
    // Background colors
    bg: /^bg-/,
    // Text colors
    text: /^text-/,
    // Border colors
    border: /^border-(?!(?:\d|x|y|t|b|l|r|solid|dashed|dotted|double|none))/,
    // Padding
    p: /^p-|^px-|^py-|^pt-|^pb-|^pl-|^pr-/,
    // Margin
    m: /^m-|^mx-|^my-|^mt-|^mb-|^ml-|^mr-/,
    // Width
    w: /^w-/,
    // Height
    h: /^h-/,
    // Display
    display: /^(block|inline|flex|grid|hidden|table)/,
    // Position
    position: /^(static|relative|absolute|fixed|sticky)/,
    // Border radius
    rounded: /^rounded/,
    // Opacity
    opacity: /^opacity-/,
    // Font size
    fontSize: /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)/,
    // Font weight
    fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)/,
  };

  // Process each class
  for (const className of classArray) {
    let group = 'other';
    
    // Find which group this class belongs to
    for (const [groupName, pattern] of Object.entries(conflictGroups)) {
      if (pattern.test(className)) {
        group = groupName;
        break;
      }
    }

    // Store the class, overriding previous ones in the same group
    classMap.set(group === 'other' ? className : group, className);
  }

  return Array.from(classMap.values()).join(' ');
}

/**
 * Combines clsx and twMerge functionality (cn replacement)
 * @param {...any} inputs - Class names to combine and merge
 * @returns {string} Combined and merged class names
 */
export function cn(...inputs) {
  return twMerge(clsx(...inputs));
}

/**
 * Creates a variant system for components (CVA replacement)
 * @param {string} base - Base class names
 * @param {Object} config - Variant configuration
 * @returns {Function} Variant function
 */
export function cva(base, config = {}) {
  return function(props = {}) {
    const { variants = {}, defaultVariants = {} } = config;
    const classes = [base];

    // Apply variants
    for (const [variantKey, variantValue] of Object.entries({ ...defaultVariants, ...props })) {
      if (variants[variantKey] && variants[variantKey][variantValue]) {
        classes.push(variants[variantKey][variantValue]);
      }
    }

    // Apply compound variants if they exist
    if (config.compoundVariants) {
      for (const compound of config.compoundVariants) {
        const { class: compoundClass, ...conditions } = compound;
        const matches = Object.entries(conditions).every(([key, value]) => 
          props[key] === value
        );
        if (matches) {
          classes.push(compoundClass);
        }
      }
    }

    return cn(...classes);
  };
}

/**
 * Slot component functionality for vanilla JS
 * Allows components to be composed together
 */
export class Slot {
  constructor(element, asChild = false) {
    this.element = element;
    this.asChild = asChild;
  }

  render(children) {
    if (this.asChild && children && children.length > 0) {
      // If asChild is true, merge props with the first child
      const firstChild = children[0];
      if (firstChild && firstChild.nodeType === Node.ELEMENT_NODE) {
        // Merge classes
        const existingClasses = firstChild.className || '';
        const slotClasses = this.element.className || '';
        firstChild.className = cn(existingClasses, slotClasses);
        
        // Merge attributes
        for (const attr of this.element.attributes) {
          if (attr.name !== 'class') {
            firstChild.setAttribute(attr.name, attr.value);
          }
        }
        
        return firstChild;
      }
    }
    
    // Default behavior: use the slot element
    return this.element;
  }
}