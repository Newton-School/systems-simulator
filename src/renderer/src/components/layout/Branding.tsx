import logoUrl from '../../assets/nst-logo.png'

export const Branding = () => (
  <div className="mr-2 flex select-none items-center gap-2">
    <img src={logoUrl} alt="NST logo" className="h-6 w-6 object-contain" />
    <span className="nss-branding-full text-sm font-bold tracking-tight text-nss-text">
      System Design Simulator
    </span>
    <span className="nss-branding-compact hidden text-sm font-bold tracking-tight text-nss-text">
      Simulator
    </span>
  </div>
)
