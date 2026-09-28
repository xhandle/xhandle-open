// Read-only storage diagnostics must not hold the settings panel open indefinitely.
export function storageScanTimeout(operation, label, milliseconds = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out.')), milliseconds);
    Promise.resolve().then(operation).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
