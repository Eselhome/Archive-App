import React from 'react';

interface DonkeyHeadIconProps {
  className?: string;
}

export const DonkeyHeadIcon: React.FC<DonkeyHeadIconProps> = ({ className = 'w-7 h-7' }) => {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Linkes und rechtes langes Eselsohr */}
      <path
        d="M11.5 11.5L7.5 3.5C7.1 2.7 8.1 2.1 8.8 2.7L14 7.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.5 11.5L24.5 3.5C24.9 2.7 23.9 2.1 23.2 2.7L18 7.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Mähnenbüschel zwischen den Ohren */}
      <path
        d="M14 7.8L16 5.5L18 7.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Kopfkontur & schmale Schnauze */}
      <path
        d="M11.5 11.5C10.2 13.5 10 15.8 11 18L12.4 24.5C12.8 26.5 14.2 28 16 28C17.8 28 19.2 26.5 19.6 24.5L21 18C22 15.8 21.8 13.5 20.5 11.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Augen */}
      <circle cx="13.2" cy="15.2" r="1.1" fill="currentColor" />
      <circle cx="18.8" cy="15.2" r="1.1" fill="currentColor" />
      {/* Maulpartie & Nüstern */}
      <path
        d="M12.3 21.5C13.4 20.9 14.6 20.7 16 20.7C17.4 20.7 18.6 20.9 19.7 21.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="14.3" cy="24.2" r="0.85" fill="currentColor" />
      <circle cx="17.7" cy="24.2" r="0.85" fill="currentColor" />
    </svg>
  );
};
