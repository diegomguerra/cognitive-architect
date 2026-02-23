import brainIcon from '@/assets/brain-icon.png';

interface BrainLogoProps {
  size?: number;
}

const BrainLogo = ({ size = 48 }: BrainLogoProps) => {
  return (
    <div
      className="rounded-lg overflow-hidden flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <img
        src={brainIcon}
        alt="VYR"
        className="w-full h-full object-cover"
        style={{ animation: 'glow-pulse 3s ease-in-out infinite' }}
      />
    </div>
  );
};

export default BrainLogo;
