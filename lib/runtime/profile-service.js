export class ProfileService {
  constructor() {
    this.userProfiles = new Map();
  }

  getProfiles(wallet = "default") {
    const key = wallet.toLowerCase();
    if (!this.userProfiles.has(key)) {
      this.userProfiles.set(key, {
        profiles: [],
        activeId: null
      });
    }
    return this.userProfiles.get(key);
  }

  addProfile(wallet = "default", profileData) {
    const data = this.getProfiles(wallet);
    const newProf = {
      id: `prof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: String(profileData.name || "新命主").trim(),
      date: profileData.date || "1995-01-01",
      time: profileData.time || "12:00",
      gender: profileData.gender || "male",
      timeKnown: profileData.timeKnown !== false,
      birthplace: profileData.birthplace ? String(profileData.birthplace).trim() : ""
    };
    data.profiles.push(newProf);
    data.activeId = newProf.id;
    return newProf;
  }

  switchProfile(wallet = "default", profileId) {
    const data = this.getProfiles(wallet);
    const found = data.profiles.find(p => p.id === profileId);
    if (found) {
      data.activeId = found.id;
    }
    return this.getActiveProfile(wallet);
  }

  getActiveProfile(wallet = "default") {
    const data = this.getProfiles(wallet);
    return data.profiles.find(p => p.id === data.activeId) || data.profiles[0];
  }
}

export const defaultProfileService = new ProfileService();
