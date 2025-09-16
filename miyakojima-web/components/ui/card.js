/**
 * Shadcn/UI Card Component - Vanilla JavaScript Implementation
 * Based on @shadcn/ui card component with full composition support
 */

import { cn } from '../core/utils.js';

/**
 * Card component class
 */
export class Card {
  constructor(options = {}) {
    this.options = {
      className: '',
      ...options
    };
  }

  /**
   * Create a card container element
   * @param {Object} options - Card configuration
   * @param {string} options.className - Additional CSS classes
   * @param {HTMLElement|string|Array} options.children - Card content
   * @param {Object} options.props - Additional attributes
   * @returns {HTMLElement} Card element
   */
  static create(options = {}) {
    const {
      className = '',
      children = '',
      ...props
    } = options;

    // Create card element
    const card = document.createElement('div');
    card.className = cn(
      'bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm',
      className
    );
    
    // Set content
    this.setContent(card, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        card.setAttribute(key, value);
      }
    });

    // Add data-slot for styling hooks
    card.setAttribute('data-slot', 'card');

    return card;
  }

  /**
   * Create a card header element
   * @param {Object} options - Header configuration
   * @returns {HTMLElement} Card header element
   */
  static createHeader(options = {}) {
    const {
      className = '',
      children = '',
      ...props
    } = options;

    const header = document.createElement('div');
    header.className = cn('flex flex-col gap-1.5 px-6', className);
    
    this.setContent(header, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        header.setAttribute(key, value);
      }
    });

    header.setAttribute('data-slot', 'card-header');

    return header;
  }

  /**
   * Create a card title element
   * @param {Object} options - Title configuration
   * @returns {HTMLElement} Card title element
   */
  static createTitle(options = {}) {
    const {
      className = '',
      children = '',
      as = 'div',
      ...props
    } = options;

    const title = document.createElement(as);
    title.className = cn('font-semibold leading-none tracking-tight', className);
    
    this.setContent(title, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        title.setAttribute(key, value);
      }
    });

    title.setAttribute('data-slot', 'card-title');

    return title;
  }

  /**
   * Create a card description element
   * @param {Object} options - Description configuration
   * @returns {HTMLElement} Card description element
   */
  static createDescription(options = {}) {
    const {
      className = '',
      children = '',
      as = 'div',
      ...props
    } = options;

    const description = document.createElement(as);
    description.className = cn('text-sm text-muted-foreground', className);
    
    this.setContent(description, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        description.setAttribute(key, value);
      }
    });

    description.setAttribute('data-slot', 'card-description');

    return description;
  }

  /**
   * Create a card action element (for header actions)
   * @param {Object} options - Action configuration
   * @returns {HTMLElement} Card action element
   */
  static createAction(options = {}) {
    const {
      className = '',
      children = '',
      ...props
    } = options;

    const action = document.createElement('div');
    action.className = cn('ml-auto', className);
    
    this.setContent(action, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        action.setAttribute(key, value);
      }
    });

    action.setAttribute('data-slot', 'card-action');

    return action;
  }

  /**
   * Create a card content element
   * @param {Object} options - Content configuration
   * @returns {HTMLElement} Card content element
   */
  static createContent(options = {}) {
    const {
      className = '',
      children = '',
      ...props
    } = options;

    const content = document.createElement('div');
    content.className = cn('px-6', className);
    
    this.setContent(content, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        content.setAttribute(key, value);
      }
    });

    content.setAttribute('data-slot', 'card-content');

    return content;
  }

  /**
   * Create a card footer element
   * @param {Object} options - Footer configuration
   * @returns {HTMLElement} Card footer element
   */
  static createFooter(options = {}) {
    const {
      className = '',
      children = '',
      ...props
    } = options;

    const footer = document.createElement('div');
    footer.className = cn('flex items-center px-6', className);
    
    this.setContent(footer, children);

    // Apply additional props
    Object.entries(props).forEach(([key, value]) => {
      if (key.startsWith('data-') || key.startsWith('aria-')) {
        footer.setAttribute(key, value);
      }
    });

    footer.setAttribute('data-slot', 'card-footer');

    return footer;
  }

  /**
   * Helper method to set content on an element
   * @param {HTMLElement} element - Target element
   * @param {HTMLElement|string|Array} content - Content to set
   */
  static setContent(element, content) {
    if (typeof content === 'string') {
      element.textContent = content;
    } else if (content instanceof HTMLElement) {
      element.appendChild(content);
    } else if (Array.isArray(content)) {
      content.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          element.appendChild(child);
        }
      });
    }
  }

  /**
   * Create a complete card with header, content, and footer
   * @param {Object} options - Complete card configuration
   * @returns {HTMLElement} Complete card element
   */
  static createComplete(options = {}) {
    const {
      title,
      description,
      action,
      content,
      footer,
      className = '',
      ...cardProps
    } = options;

    // Create main card
    const card = this.create({ className, ...cardProps });

    // Create header if title, description, or action provided
    if (title || description || action) {
      const headerChildren = [];
      
      if (title) {
        headerChildren.push(this.createTitle({ children: title }));
      }
      
      if (description) {
        headerChildren.push(this.createDescription({ children: description }));
      }
      
      if (action) {
        headerChildren.push(this.createAction({ children: action }));
      }

      const header = this.createHeader({ children: headerChildren });
      card.appendChild(header);
    }

    // Create content if provided
    if (content) {
      const cardContent = this.createContent({ children: content });
      card.appendChild(cardContent);
    }

    // Create footer if provided
    if (footer) {
      const cardFooter = this.createFooter({ children: footer });
      card.appendChild(cardFooter);
    }

    return card;
  }

  /**
   * Create a card grid container
   * @param {Array} cards - Array of card configurations
   * @param {string} className - Additional classes for the grid
   * @param {number} columns - Number of columns (default: auto)
   * @returns {HTMLElement} Card grid container
   */
  static createGrid(cards = [], className = '', columns = 'auto') {
    const grid = document.createElement('div');
    
    const gridClasses = columns === 'auto' 
      ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
      : `grid grid-cols-${columns} gap-6`;
      
    grid.className = cn(gridClasses, className);

    cards.forEach(cardConfig => {
      const card = this.createComplete(cardConfig);
      grid.appendChild(card);
    });

    return grid;
  }
}

/**
 * Convenience functions for quick card creation
 */

// Basic card
export const createCard = (options = {}) => 
  Card.create(options);

// Card with header, content, and footer
export const createCompleteCard = (options = {}) =>
  Card.createComplete(options);

// Simple text card
export const createTextCard = (title, content, options = {}) =>
  Card.createComplete({ title, content, ...options });

// Info card with description
export const createInfoCard = (title, description, content, options = {}) =>
  Card.createComplete({ title, description, content, ...options });

// Card grid
export const createCardGrid = (cards, options = {}) =>
  Card.createGrid(cards, options.className, options.columns);

/**
 * Usage Examples:
 * 
 * // Basic card
 * const card = Card.create({
 *   children: 'Simple card content'
 * });
 * 
 * // Complete card
 * const completeCard = Card.createComplete({
 *   title: 'Card Title',
 *   description: 'Card description here',
 *   content: 'Main card content',
 *   footer: 'Footer content'
 * });
 * 
 * // Card with header and action
 * const actionCard = Card.createComplete({
 *   title: 'Settings',
 *   action: Button.create({ 
 *     children: 'Edit', 
 *     variant: 'ghost', 
 *     size: 'sm' 
 *   }),
 *   content: 'Settings content here'
 * });
 * 
 * // Card grid
 * const grid = Card.createGrid([
 *   { title: 'Card 1', content: 'Content 1' },
 *   { title: 'Card 2', content: 'Content 2' },
 *   { title: 'Card 3', content: 'Content 3' }
 * ]);
 * 
 * // Individual components
 * const header = Card.createHeader({
 *   children: [
 *     Card.createTitle({ children: 'Custom Title' }),
 *     Card.createDescription({ children: 'Custom description' })
 *   ]
 * });
 */