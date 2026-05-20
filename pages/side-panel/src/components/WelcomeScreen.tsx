import React from 'react';
import { BrandingSection, ActionSection } from './welcome/Sections';
import { BackgroundGradientAnimation } from './ui/background-gradient-animation';

interface WelcomeScreenProps {
    isDarkMode: boolean;
    onOpenSettings: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ isDarkMode, onOpenSettings }) => {
    return (
        <BackgroundGradientAnimation
            containerClassName={`flex-1 w-full overflow-hidden font-sans ${isDarkMode
                    ? "bg-obsidian text-slate-50 selection:bg-obsidian-accent selection:text-obsidian"
                    : "bg-luminous text-slate-600 selection:bg-luminous-accent selection:text-white"
                }`}
            className="flex size-full flex-col items-center justify-center px-8"
            gradientBackgroundStart={isDarkMode ? "rgb(2, 6, 23)" : "rgb(248, 250, 252)"}
            gradientBackgroundEnd={isDarkMode ? "rgb(12, 21, 37)" : "rgb(241, 245, 249)"}
            firstColor={isDarkMode ? "139, 92, 246" : "79, 70, 229"}
            secondColor={isDarkMode ? "56, 189, 248" : "99, 102, 241"}
            thirdColor={isDarkMode ? "30, 41, 59" : "148, 163, 184"}
            fourthColor={isDarkMode ? "12, 21, 37" : "226, 232, 240"}
            fifthColor={isDarkMode ? "2, 6, 23" : "248, 250, 252"}
            pointerColor={isDarkMode ? "139, 92, 246" : "79, 70, 229"}
        >
            <div className="z-10 w-full max-w-md animate-rise space-y-12 text-center">
                <BrandingSection isDarkMode={isDarkMode} />
                <ActionSection isDarkMode={isDarkMode} onOpenSettings={onOpenSettings} />
            </div>
        </BackgroundGradientAnimation>
    );
};

export default WelcomeScreen;
