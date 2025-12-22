import React from 'react';
import { AppStep } from '../types';

interface StepIndicatorProps {
  currentStep: AppStep;
}

const steps = [
  { id: AppStep.UPLOAD, label: "Upload" },
  { id: AppStep.TRANSCRIBING, label: "Transcribe" },
  { id: AppStep.EDIT_SRT, label: "Edit Subs" },
  { id: AppStep.GENERATING_IMAGE, label: "Art" },
  { id: AppStep.PREVIEW_DOWNLOAD, label: "Done" },
];

export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div className="flex justify-between items-center relative">
        {/* Connector Line */}
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-800 -z-10 rounded"></div>
        <div 
          className="absolute left-0 top-1/2 transform -translate-y-1/2 h-1 bg-gradient-to-r from-blue-500 to-purple-500 -z-10 rounded transition-all duration-500"
          style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
        ></div>

        {steps.map((step) => {
          const isActive = currentStep >= step.id;
          const isCurrent = currentStep === step.id;
          return (
            <div key={step.id} className="flex flex-col items-center gap-2">
              <div 
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300
                  ${isActive ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white scale-110 shadow-lg shadow-purple-500/30' : 'bg-gray-800 text-gray-400 border border-gray-700'}
                  ${isCurrent ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-black' : ''}
                `}
              >
                {step.id + 1}
              </div>
              <span className={`text-xs font-medium ${isActive ? 'text-gray-200' : 'text-gray-600'} hidden sm:block`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};