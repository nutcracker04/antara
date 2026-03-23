function hasTouchMac() {
  return /Macintosh/i.test(navigator.userAgent || "") && (navigator.maxTouchPoints || 0) > 1;
}

export function getDeviceProfile() {
  if (typeof navigator === "undefined") {
    return {
      deviceMemory: null,
      hardwareConcurrency: null,
      isConstrained: false,
      isMobile: false,
    };
  }

  const userAgent = navigator.userAgent || "";
  const isMobile = /android|iphone|ipad|ipod/i.test(userAgent) || hasTouchMac();
  const deviceMemory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : null;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null;
  const isConstrained = isMobile && (
    deviceMemory === null ||
    deviceMemory <= 6 ||
    hardwareConcurrency === null ||
    hardwareConcurrency <= 8
  );

  return {
    deviceMemory,
    hardwareConcurrency,
    isConstrained,
    isMobile,
  };
}

export function isConstrainedMobileDevice() {
  const profile = getDeviceProfile();
  return profile.isMobile && profile.isConstrained;
}
