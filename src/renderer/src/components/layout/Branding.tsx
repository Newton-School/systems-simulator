import logoUrl from '../../assets/nst-logo.png'

export const Branding = () => (
  <div className="flex items-center gap-2 mr-2 select-none">
    <img src={logoUrl} alt="NST logo" className="w-6 h-6 object-contain" />
    <span className="font-bold text-sm tracking-tight text-nss-text">System Design Simulator</span>
  </div>
)
