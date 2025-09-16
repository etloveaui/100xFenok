/**
 * Shadcn/UI Button Component - Vanilla JavaScript Implementation
 * Based on @shadcn/ui button component with full variant support
 */

import { cn, cva, Slot } from '../core/utils.js';

/**
 * Button variant system using class-variance-authority pattern
 */
const buttonVariants = cva(
  // Base classes
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

/**
 * Button component class
 */
export class Button {
  constructor(options = {}) {
    this.options = {
      variant: 'default',
      size: 'default',
      disabled: false,
      asChild: false,
      type: 'button',
      ...options
    };
  }

  /**
   * Create a button element with specified options
   * @param {Object} options - Button configuration
   * @param {string} options.variant - Button variant (default, destructive, outline, secondary, ghost, link)
   * @param {string} options.size - Button size (default, sm, lg, icon)
   * @param {boolean} options.disabled - Whether button is disabled
   * @param {boolean} options.asChild - Whether to use slot rendering
   * @param {string} options.className - Additional CSS classes
   * @param {string} options.children - Button content
   * @param {Function} options.onClick - Click handler
   * @param {string} options.type - Button type
   * @returns {HTMLElement} Button element
   */
  static create(options = {}) {
    const {
      variant = 'default',
      size = 'default',
      disabled = false,
      asChild = false,
      className = '',
      children = '',
      onClick,
      type = 'button',
      ...props
    } = options;

    // Generate button classes
    const buttonClasses = buttonVariants({ variant, size });
    const finalClasses = cn(buttonClasses, className);

    // Create button element
    const button = document.createElement(asChild ? 'div' : 'button');
    button.className = finalClasses;
    
    if (!asChild) {
      button.type = type;
      button.disabled = disabled;
    }

    // Set content
    if (typeof children === 'string') {
      button.textContent = children;
    } else if (children instanceof HTMLElement) {
      button.appendChild(children);
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') {
          button.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          button.appendChild(child);
        }
      });
    }

    // Add event listeners
    if (onClick && typeof onClick === 'function') {
      button.addEventListener('click', onClick);
    }

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        button.setAttribute(key, value);
      } else if (key in button) {
        button[key] = value;
      }
    });

    // Add data-slot for styling hooks
    button.setAttribute('data-slot', 'button');

    return button;
  }

  /**
   * Create a button with icon
   * @param {Object} options - Button options
   * @param {HTMLElement|string} options.icon - Icon element or HTML string
   * @param {string} options.position - Icon position ('left' or 'right')
   * @returns {HTMLElement} Button with icon
   */
  static createWithIcon(options = {}) {
    const { icon, position = 'left', children, ...buttonOptions } = options;
    
    const content = [];
    
    if (position === 'left' && icon) {
      content.push(typeof icon === 'string' ? this.createIconElement(icon) : icon);
    }
    
    if (children) {
      content.push(typeof children === 'string' ? document.createTextNode(children) : children);
    }
    
    if (position === 'right' && icon) {
      content.push(typeof icon === 'string' ? this.createIconElement(icon) : icon);
    }

    return this.create({ ...buttonOptions, children: content });
  }

  /**
   * Create an icon element from HTML string
   * @param {string} iconHtml - Icon HTML string
   * @returns {HTMLElement} Icon element
   */
  static createIconElement(iconHtml) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = iconHtml;
    return wrapper.firstElementChild;
  }

  /**
   * Create a button group container
   * @param {Array} buttons - Array of button configurations
   * @param {string} className - Additional classes for the group
   * @returns {HTMLElement} Button group container
   */
  static createGroup(buttons = [], className = '') {
    const group = document.createElement('div');
    group.className = cn('inline-flex rounded-md shadow-sm', className);
    group.setAttribute('role', 'group');

    buttons.forEach((buttonConfig, index) => {
      const button = this.create({
        ...buttonConfig,
        className: cn(
          buttonConfig.className,
          // First button
          index === 0 && 'rounded-r-none',
          // Middle buttons
          index > 0 && index < buttons.length - 1 && 'rounded-none border-l-0',
          // Last button
          index === buttons.length - 1 && buttons.length > 1 && 'rounded-l-none border-l-0'
        )
      });
      group.appendChild(button);
    });

    return group;
  }

  /**
   * Get button variant classes for use with other elements
   * @param {Object} options - Variant options
   * @returns {string} CSS classes
   */
  static getVariantClasses(options = {}) {
    return buttonVariants(options);
  }
}

// Export button variants for external use
export { buttonVariants };

/**
 * Convenience functions for quick button creation
 */

// Primary button
export const createPrimaryButton = (options = {}) => 
  Button.create({ variant: 'default', ...options });

// Secondary button  
export const createSecondaryButton = (options = {}) =>
  Button.create({ variant: 'secondary', ...options });

// Outline button
export const createOutlineButton = (options = {}) =>
  Button.create({ variant: 'outline', ...options });

// Destructive button
export const createDestructiveButton = (options = {}) =>
  Button.create({ variant: 'destructive', ...options });

// Ghost button
export const createGhostButton = (options = {}) =>
  Button.create({ variant: 'ghost', ...options });

// Link button
export const createLinkButton = (options = {}) =>
  Button.create({ variant: 'link', ...options });

// Icon button
export const createIconButton = (options = {}) =>
  Button.create({ size: 'icon', ...options });

// Small button
export const createSmallButton = (options = {}) =>
  Button.create({ size: 'sm', ...options });

// Large button
export const createLargeButton = (options = {}) =>
  Button.create({ size: 'lg', ...options });

/**
 * Usage Examples:
 * 
 * // Basic button
 * const button = Button.create({
 *   children: 'Click me',
 *   onClick: () => console.log('clicked')
 * });
 * 
 * // Outline button with icon
 * const iconButton = Button.createWithIcon({
 *   variant: 'outline',
 *   icon: '<svg>...</svg>',
 *   children: 'Save',
 *   position: 'left'
 * });
 * 
 * // Button group
 * const group = Button.createGroup([
 *   { children: 'Left', variant: 'outline' },
 *   { children: 'Center', variant: 'outline' },
 *   { children: 'Right', variant: 'outline' }
 * ]);
 * 
 * // Using convenience functions
 * const primary = createPrimaryButton({ children: 'Primary' });
 * const secondary = createSecondaryButton({ children: 'Secondary' });
 */