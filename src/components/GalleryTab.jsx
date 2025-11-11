import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { motion } from "framer-motion";
import toast from "react-hot-toast";


export default function GalleryTab({ user }) {
  const [journeys, setJourneys] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Upload form state
  const [selectedJourney, setSelectedJourney] = useState("");
  const [selectedStation, setSelectedStation] = useState("");
  const [selectedAction, setSelectedAction] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // Fetch user's journeys
  useEffect(() => {
    async function fetchJourneys() {
      if (!user) return;
      
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("logs_clean_v")
          .select("timestamp, station, action, journey_id")
          .eq("email", user.email)
          .order("timestamp", { ascending: false });
        
        if (error) throw error;
        
        // Group by journey_id
        const grouped = data.reduce((acc, log) => {
          if (!acc[log.journey_id]) {
            acc[log.journey_id] = { id: log.journey_id, logs: [] };
          }
          acc[log.journey_id].logs.push(log);
          return acc;
        }, {});
        
        setJourneys(Object.values(grouped));
      } catch (err) {
        console.error("Error fetching journeys:", err);
        toast.error("Failed to load journeys");
      } finally {
        setLoading(false);
      }
    }
    
    fetchJourneys();
  }, [user]);

  // Fetch user's photos
  useEffect(() => {
    async function fetchPhotos() {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from("photos")
          .select("*")
          .eq("email", user.email)
          .order("created_at", { ascending: false });
        
        if (error) throw error;
        setPhotos(data || []);
      } catch (err) {
        console.error("Error fetching photos:", err);
      }
    }
    
    fetchPhotos();
  }, [user]);

  // Get stations for selected journey
  const stationsForJourney = useMemo(() => {
    if (!selectedJourney) return [];
    const journey = journeys.find(j => j.id === selectedJourney);
    if (!journey) return [];
    
    return journey.logs.map(log => ({
      station: log.station,
      action: log.action,
      timestamp: log.timestamp
    }));
  }, [selectedJourney, journeys]);

  // Handle file selection
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File too large. Max 5MB.");
        return;
      }
      setSelectedFile(file);
    }
  }

  // Upload photo
  async function handleUpload() {
    if (!selectedFile || !selectedJourney || !selectedStation || !selectedAction) {
      toast.error("Please fill all fields");
      return;
    }

    try {
      setUploading(true);
      
      // Upload to storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("station-photos")
        .upload(fileName, selectedFile);
      
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("station-photos")
        .getPublicUrl(fileName);
      
      // Save metadata to photos table
      const { error: dbError } = await supabase
        .from("photos")
        .insert({
          user_id: user.id,
          email: user.email,
          journey_id: selectedJourney,
          station: selectedStation,
          action: selectedAction,
          photo_url: publicUrl,
          caption: caption || null,
        });
      
      if (dbError) throw dbError;
      
      toast.success("📸 Photo uploaded!");
      
      // Refresh photos
      const { data } = await supabase
        .from("photos")
        .select("*")
        .eq("email", user.email)
        .order("created_at", { ascending: false });
      setPhotos(data || []);
      
      // Reset form
      setSelectedJourney("");
      setSelectedStation("");
      setSelectedAction("");
      setCaption("");
      setSelectedFile(null);
      
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Failed to upload photo");
    } finally {
      setUploading(false);
    }
  }

  // Delete photo
  async function handleDelete(photoId, photoUrl) {
    if (!confirm("Delete this photo?")) return;
    
    try {
      // Delete from storage
      const fileName = photoUrl.split('/').slice(-2).join('/');
      await supabase.storage
        .from("station-photos")
        .remove([fileName]);
      
      // Delete from database
      const { error } = await supabase
        .from("photos")
        .delete()
        .eq("id", photoId);
      
      if (error) throw error;
      
      setPhotos(photos.filter(p => p.id !== photoId));
      toast.success("Photo deleted");
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Failed to delete photo");
    }
  }

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">📸 Photo Gallery</h1>
        <p className="text-sm text-slate-400 mt-1">Upload photos from your metro journeys</p>
      </header>

      {/* Upload Section */}
      <section className="bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">Upload New Photo</h2>
        
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Select Journey
          </label>
          <select
            value={selectedJourney}
            onChange={(e) => {
              setSelectedJourney(e.target.value);
              setSelectedStation("");
              setSelectedAction("");
            }}
            className="w-full bg-slate-700 text-slate-100 rounded-lg p-2 border border-slate-600"
          >
            <option value="">Choose a journey...</option>
            {journeys.map((journey) => {
              const on = journey.logs.find(l => l.action === 'on');
              const off = journey.logs.find(l => l.action === 'off');
              const date = new Date(on?.timestamp || journey.logs[0].timestamp);
              return (
                <option key={journey.id} value={journey.id}>
                  {date.toLocaleDateString()} {date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - 
                  {on?.station || '?'} → {off?.station || '?'}
                </option>
              );
            })}
          </select>
        </div>

        {selectedJourney && stationsForJourney.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Select Station
            </label>
            <select
              value={`${selectedStation}|${selectedAction}`}
              onChange={(e) => {
                const [station, action] = e.target.value.split('|');
                setSelectedStation(station);
                setSelectedAction(action);
              }}
              className="w-full bg-slate-700 text-slate-100 rounded-lg p-2 border border-slate-600"
            >
              <option value="">Choose a station...</option>
              {stationsForJourney.map((s, i) => (
                <option key={i} value={`${s.station}|${s.action}`}>
                  {s.station} ({s.action === 'on' ? 'Boarded' : 'Exited'})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Photo
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="w-full text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
          />
          {selectedFile && (
            <p className="text-xs text-slate-400 mt-1">
              Selected: {selectedFile.name}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Caption (optional)
          </label>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption..."
            className="w-full bg-slate-700 text-slate-100 rounded-lg p-2 border border-slate-600"
          />
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !selectedFile || !selectedJourney || !selectedStation}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition"
        >
          {uploading ? "Uploading..." : "📤 Upload Photo"}
        </button>
      </section>

      {/* Gallery Grid */}
      <section>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">
          Your Photos ({photos.length})
        </h2>
        
        {photos.length === 0 ? (
          <div className="text-center text-slate-400 py-12 bg-slate-800 rounded-2xl border border-slate-700">
            No photos yet. Upload your first one!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {photos.map((photo) => (
              <motion.div
                key={photo.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg"
              >
                <img
                  src={photo.photo_url}
                  alt={photo.caption || photo.station}
                  className="w-full h-48 object-cover"
                />
                <div className="p-3">
                  <div className="text-sm font-medium text-slate-200">
                    📍 {photo.station}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {photo.action === 'on' ? '🚇 Boarded' : '🏁 Exited'}
                  </div>
                  {photo.caption && (
                    <p className="text-sm text-slate-300 mt-2">{photo.caption}</p>
                  )}
                  <div className="text-xs text-slate-500 mt-2">
                    {new Date(photo.created_at).toLocaleDateString()}
                  </div>
                  <button
                    onClick={() => handleDelete(photo.id, photo.photo_url)}
                    className="text-red-400 hover:text-red-300 text-xs mt-2"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}