import { SquareDashed } from 'lucide-react'

const EmptyFlowState = ({
  isEmpty,
  hidden = false
}: {
  isEmpty: boolean
  hidden?: boolean
}) => {
  const visible = isEmpty && !hidden
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        fontSize: '18px',
        zIndex: 10,
        color: 'var(--nss-muted)',

        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
        transition: 'opacity 0.2s ease-in-out, visibility 0.2s ease-in-out'
      }}
    >
      <div className="flex flex-col items-center justify-center h-full">
        <SquareDashed size={30} className="mx-auto mb-2" />
        <p>Drag a node from the library to get started</p>
      </div>
    </div>
  )
}

export default EmptyFlowState
