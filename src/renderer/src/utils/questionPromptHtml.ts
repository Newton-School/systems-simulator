const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
])

const DROP_CONTENT_TAGS = new Set(['iframe', 'object', 'embed', 'script', 'style'])

function unwrapElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) {
    return
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function isSafeHref(href: string): boolean {
  if (href.startsWith('#')) {
    return true
  }

  try {
    const url = new URL(href, 'https://example.invalid')
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function sanitizeNode(node: Node): void {
  if (node.nodeType === Node.COMMENT_NODE) {
    node.parentNode?.removeChild(node)
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (DROP_CONTENT_TAGS.has(tag)) {
    element.remove()
    return
  }

  for (const child of [...element.childNodes]) {
    sanitizeNode(child)
  }

  if (!ALLOWED_TAGS.has(tag)) {
    unwrapElement(element)
    return
  }

  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'id') {
      element.removeAttribute(attribute.name)
      continue
    }

    if (tag !== 'a') {
      element.removeAttribute(attribute.name)
      continue
    }

    if (!['href', 'title', 'target'].includes(name)) {
      element.removeAttribute(attribute.name)
    }
  }

  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (!href || !isSafeHref(href)) {
      element.removeAttribute('href')
    }

    const target = element.getAttribute('target')
    if (target === '_blank') {
      element.setAttribute('rel', 'noopener noreferrer')
    } else if (target) {
      element.removeAttribute('target')
    }
  }
}

export function sanitizeQuestionPromptHtml(rawHtml: string): string {
  if (typeof DOMParser === 'undefined') {
    return rawHtml
  }

  const parser = new DOMParser()
  const document = parser.parseFromString(`<div>${rawHtml}</div>`, 'text/html')
  const root = document.body.firstElementChild
  if (!root) {
    return ''
  }

  for (const child of [...root.childNodes]) {
    sanitizeNode(child)
  }

  return root.innerHTML.trim()
}
