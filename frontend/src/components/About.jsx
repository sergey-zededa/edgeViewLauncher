import { useState, useEffect } from 'react';
import { getElectronAppInfo, openExternal } from '../tauriAPI';
import { X, ExternalLink } from 'lucide-react';
import zededaLogo from '../assets/zededa-logo.png';
import './About.css';

const About = ({ onClose }) => {
    const [appInfo, setAppInfo] = useState({
        version: '...',
        buildNumber: '...',
        buildDate: null,
        gitCommit: null
    });

    useEffect(() => {
        getElectronAppInfo().then(info => {
            setAppInfo(info);
        }).catch(err => {
            console.error('Failed to get app info:', err);
        });
    }, []);

    return (
        <div className="about-overlay">
            <div className="about-modal">
                <button className="close-btn" onClick={onClose}>
                    <X size={20} />
                </button>

                <div className="about-content">
                    <img src={zededaLogo} alt="ZEDEDA" className="zededa-logo" />

                    <div className="app-info">
                        <h2>EdgeView Launcher</h2>
                        <p className="version">Version {appInfo.version}</p>
                        <p className="build-number">Build {appInfo.buildNumber}</p>
                    </div>

                    <div className="copyright-section">
                        <p>&copy; 2025-2026 ZEDEDA. All rights reserved.</p>
                        <div className="about-links">
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    openExternal('https://zededa.com');
                                }}
                                className="website-link"
                            >
                                zededa.com <ExternalLink size={12} />
                            </a>
                            <span className="link-separator">•</span>
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    openExternal('https://github.com/sergey-zededa/edgeViewLauncher/releases');
                                }}
                                className="website-link"
                            >
                                What's New <ExternalLink size={12} />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default About;
