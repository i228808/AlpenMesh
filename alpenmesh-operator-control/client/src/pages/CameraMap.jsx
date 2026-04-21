import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import Hls from 'hls.js';
import {
  MapPin,
  Video,
  Radio,
  Wifi,
  WifiOff,
  X,
  Play,
  Square,
  Maximize2,
  Search,
  ZoomIn,
  ZoomOut,
  Locate,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with Vite/React
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Custom camera icon
const createCameraIcon = (isOnline) => {
  return L.divIcon({
    className: 'custom-camera-marker',
    html: `
            <div style="
                width: 28px;
                height: 28px;
                background: ${isOnline ? 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)' : '#374151'};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                border: 2px solid ${isOnline ? '#38bdf8' : '#4b5563'};
            ">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                    <path d="m16 6 4 14"></path>
                    <path d="M12 6v14"></path>
                    <path d="M8 8v12"></path>
                    <path d="M4 4v16"></path>
                </svg>
            </div>
        `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};

// Component to fit map bounds to all cameras
function FitBounds({ cameras }) {
  const map = useMap();

  useEffect(() => {
    if (cameras.length > 0) {
      const bounds = L.latLngBounds(cameras.map((cam) => [cam.latitude, cam.longitude]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [cameras, map]);

  return null;
}

// Component to fly to selected camera
function FlyToCamera({ camera }) {
  const map = useMap();

  useEffect(() => {
    if (camera?.latitude && camera?.longitude) {
      map.flyTo([camera.latitude, camera.longitude], 15, {
        duration: 1.5,
      });
    }
  }, [camera, map]);

  return null;
}

// Custom Zoom Controls Component
function ZoomControls({ cameras }) {
  const map = useMap();

  const handleZoomIn = () => {
    map.zoomIn();
  };

  const handleZoomOut = () => {
    map.zoomOut();
  };

  const handleFitAll = () => {
    if (cameras.length > 0) {
      const bounds = L.latLngBounds(cameras.map((cam) => [cam.latitude, cam.longitude]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  };

  return (
    <div className="absolute bottom-6 right-6 z-[1000] flex flex-col gap-2">
      <button
        onClick={handleZoomIn}
        className="w-10 h-10 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 shadow-xl hover:bg-gray-800 transition-colors flex items-center justify-center text-white"
        title="Zoom in"
        aria-label="Zoom in"
      >
        <ZoomIn className="w-5 h-5" />
      </button>
      <button
        onClick={handleZoomOut}
        className="w-10 h-10 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 shadow-xl hover:bg-gray-800 transition-colors flex items-center justify-center text-white"
        title="Zoom out"
        aria-label="Zoom out"
      >
        <ZoomOut className="w-5 h-5" />
      </button>
      <button
        onClick={handleFitAll}
        className="w-10 h-10 bg-gray-900/90 backdrop-blur-md rounded-lg border border-gray-700/50 shadow-xl hover:bg-sky-600 transition-colors flex items-center justify-center text-white"
        title="Fit all cameras"
        aria-label="Fit all cameras"
      >
        <Locate className="w-5 h-5" />
      </button>
    </div>
  );
}

// HLS Video Player Component
function HLSVideoPlayer({ streamUrl, poster, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          setError(true);
        }
      });
      return () => hls.destroy();
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
    }
  }, [streamUrl]);

  const handleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen().catch((err) => {
        console.error('Fullscreen error:', err);
      });
    }
  };

  if (error) {
    return (
      <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
        <div className="text-center text-gray-400">
          <WifiOff className="w-10 h-10 mx-auto mb-2" />
          <p className="text-sm">Stream unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative aspect-video bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
        poster={poster}
      />
      <div className="absolute top-2 right-2 flex gap-2">
        <button
          onClick={handleFullscreen}
          className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
          title="Toggle fullscreen"
          aria-label="Toggle fullscreen"
        >
          <Maximize2 className="w-4 h-4 text-white" />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
          aria-label="Close stream"
          title="Close stream"
        >
          <X className="w-4 h-4 text-white" />
        </button>
      </div>
      <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600/90 text-white text-xs px-2 py-1 rounded-full">
        <Radio className="w-3 h-3 animate-pulse" />
        LIVE
      </div>
    </div>
  );
}

const CameraMap = () => {
  const location = useLocation();
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [showStream, setShowStream] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const [pendingCameraName, setPendingCameraName] = useState(null);

  // Filter cameras based on search query
  const filteredCameras = searchQuery.trim()
    ? cameras.filter(
        (cam) =>
          cam.cameraName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cam.location?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cam.roadway?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : [];

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cam = params.get('camera');
    setPendingCameraName(cam);
  }, [location.search]);

  useEffect(() => {
    // Load camera data from the assets
    fetch('/Camera_List.txt')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to load camera data');
        }
        return response.text();
      })
      .then((text) => {
        const lines = text.trim().split('\n');
        const parsedCameras = lines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch (e) {
              console.error('Error parsing line:', line);
              return null;
            }
          })
          .filter((cam) => cam && cam.latitude && cam.longitude);

        setCameras(parsedCameras);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading cameras:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!pendingCameraName || cameras.length === 0) return;
    const needle = pendingCameraName.toLowerCase();
    const match =
      cameras.find((c) => (c.cameraName || '').toLowerCase() === needle) ||
      cameras.find((c) => (c.cameraName || '').toLowerCase().includes(needle));
    if (match) setSelectedCamera(match);
  }, [pendingCameraName, cameras]);

  // Reset stream when camera changes
  useEffect(() => {
    setShowStream(false);
  }, [selectedCamera]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading Camera Map...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-red-400">
          <WifiOff className="w-16 h-16 mx-auto mb-4" />
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex">
      {/* Map Container */}
      <div className="flex-1 relative">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-[1000] p-4 pointer-events-none">
          <div className="bg-gray-900/90 backdrop-blur-md rounded-xl p-4 border border-gray-700/50 shadow-xl pointer-events-auto inline-block">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <MapPin className="w-5 h-5 text-sky-400" />
              Camera Map & Live Streams
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {cameras.length} cameras across Seattle • Click markers to view details
            </p>
          </div>

          {/* Search Button */}
          <div className="pointer-events-auto relative ml-4">
            {!isSearchOpen ? (
              <button
                onClick={() => {
                  setIsSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                className="bg-gray-900/90 backdrop-blur-md rounded-xl p-3 border border-gray-700/50 shadow-xl hover:bg-gray-800 transition-colors"
                title="Search cameras"
                aria-label="Search cameras"
              >
                <Search className="w-5 h-5 text-sky-400" />
              </button>
            ) : (
              <div className="bg-gray-900/90 backdrop-blur-md rounded-xl border border-gray-700/50 shadow-xl">
                <div className="flex items-center">
                  <Search className="w-4 h-4 text-gray-400 ml-3" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search cameras..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSearchResults(true);
                    }}
                    onFocus={() => setShowSearchResults(true)}
                    className="bg-transparent text-white placeholder-gray-500 px-3 py-3 w-64 text-sm focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setShowSearchResults(false);
                      setIsSearchOpen(false);
                    }}
                    className="p-2 hover:bg-gray-800 rounded-lg mr-1 transition-colors"
                    aria-label="Close search"
                    title="Close search"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                {/* Search Results Dropdown */}
                {showSearchResults && filteredCameras.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700/50 shadow-xl max-h-64 overflow-y-auto">
                    {filteredCameras.slice(0, 10).map((cam, idx) => (
                      <button
                        key={`search-${cam.imageId}-${idx}`}
                        onClick={() => {
                          setSelectedCamera(cam);
                          setSearchQuery('');
                          setShowSearchResults(false);
                          setIsSearchOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors border-b border-gray-800 last:border-0"
                      >
                        <div className="font-medium text-sm text-white">{cam.cameraName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{cam.location}</div>
                      </button>
                    ))}
                    {filteredCameras.length > 10 && (
                      <div className="px-4 py-2 text-xs text-gray-500 text-center">
                        + {filteredCameras.length - 10} more results
                      </div>
                    )}
                  </div>
                )}

                {showSearchResults && searchQuery && filteredCameras.length === 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700/50 shadow-xl p-4 text-center text-gray-500 text-sm">
                    No cameras found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <MapContainer
          center={[47.6062, -122.3321]}
          zoom={11}
          className="h-full w-full"
          style={{ height: '100vh', background: '#111827' }}
          scrollWheelZoom={true}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {cameras.length > 0 && <FitBounds cameras={cameras} />}
          {selectedCamera && <FlyToCamera camera={selectedCamera} />}
          <ZoomControls cameras={cameras} />

          {cameras.map((camera, index) => (
            <Marker
              key={`${camera.imageId}-${index}`}
              position={[camera.latitude, camera.longitude]}
              icon={createCameraIcon(!!camera.streamUrl)}
              eventHandlers={{
                click: () => setSelectedCamera(camera),
              }}
            >
              <Popup className="camera-popup-custom">
                <div className="bg-gray-800 p-3 rounded-lg min-w-[200px]">
                  <h3 className="font-semibold text-white text-sm mb-2">{camera.cameraName}</h3>
                  <p className="text-xs text-gray-400 mb-2">{camera.location}</p>
                  {camera.streamUrl && (
                    <div className="flex items-center gap-1 text-green-400 text-xs">
                      <Wifi className="w-3 h-3" />
                      Live stream available
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Side Panel */}
      <div
        className={`w-96 bg-gray-900 border-l border-gray-800 flex flex-col transition-all duration-300 ${selectedCamera ? 'translate-x-0' : 'translate-x-full hidden'}`}
      >
        {selectedCamera && (
          <>
            {/* Header */}
            <div className="p-4 border-b border-gray-800 flex items-start justify-between">
              <div>
                <h2 className="font-bold text-lg">{selectedCamera.cameraName}</h2>
                <p className="text-sm text-gray-400 mt-1">{selectedCamera.location}</p>
              </div>
              <button
                onClick={() => setSelectedCamera(null)}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="Close camera details"
                title="Close camera details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stream/Image */}
            <div className="p-4">
              {showStream && selectedCamera.streamUrl ? (
                <HLSVideoPlayer
                  streamUrl={selectedCamera.streamUrl + 'playlist.m3u8'}
                  poster={selectedCamera.url}
                  onClose={() => setShowStream(false)}
                />
              ) : (
                <div className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden">
                  <img
                    src={selectedCamera.url}
                    alt={selectedCamera.cameraName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src =
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect fill="%231f2937" width="400" height="300"/><text fill="%234b5563" x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="sans-serif">Camera Unavailable</text></svg>';
                    }}
                  />
                  {selectedCamera.streamUrl && (
                    <button
                      onClick={() => setShowStream(true)}
                      className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/50 transition-colors group"
                    >
                      <div className="w-16 h-16 bg-sky-500 rounded-full flex items-center justify-center group-hover:bg-sky-400 transition-colors shadow-lg">
                        <Play className="w-8 h-8 text-white ml-1" />
                      </div>
                    </button>
                  )}
                  <div className="absolute top-2 left-2">
                    {selectedCamera.streamUrl ? (
                      <div className="flex items-center gap-1 bg-green-600/90 text-white text-xs px-2 py-1 rounded-full">
                        <Wifi className="w-3 h-3" />
                        Online
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 bg-gray-600/90 text-white text-xs px-2 py-1 rounded-full">
                        <WifiOff className="w-3 h-3" />
                        Image Only
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 p-4 overflow-y-auto">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Camera Details
              </h3>
              <div className="space-y-3">
                {selectedCamera.roadway && (
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <label className="text-xs text-gray-500">Roadway</label>
                    <p className="font-medium mt-0.5">{selectedCamera.roadway}</p>
                  </div>
                )}
                {selectedCamera.imageId && (
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <label className="text-xs text-gray-500">Camera ID</label>
                    <p className="font-mono text-sm mt-0.5">{selectedCamera.imageId}</p>
                  </div>
                )}
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <label className="text-xs text-gray-500">Coordinates</label>
                  <p className="font-mono text-sm mt-0.5">
                    {selectedCamera.latitude.toFixed(6)}, {selectedCamera.longitude.toFixed(6)}
                  </p>
                </div>
                {selectedCamera.heading !== null && selectedCamera.heading !== 0 && (
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <label className="text-xs text-gray-500">Heading</label>
                    <p className="font-medium mt-0.5">
                      {selectedCamera.heading}° {selectedCamera.directionCode || ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* No selection state */}
      {!selectedCamera && (
        <div className="w-96 bg-gray-900 border-l border-gray-800 flex items-center justify-center">
          <div className="text-center p-8">
            <MapPin className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500">
              Select a camera marker on the map to view details and live stream
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraMap;
