export function shouldShowQuestionSupportDetails(search?: string): boolean {
  if (typeof window === 'undefined') {
    return search === '?showSupportDetails=1' || search === '?showSupportDetails=true'
  }

  const value = new URLSearchParams(search ?? window.location.search).get('showSupportDetails')
  return value === '1' || value === 'true'
}
