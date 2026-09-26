module.exports = async function drainHandle(handle) {
  const exited = new Promise((resolve) => {
    handle.onExit(() => resolve());
  });
  try {
    handle.kill();
  } catch (err) {
    console.error('kill', err);
  }
  await exited;
  try {
    handle.dispose();
  } catch (err) {
    console.error('dispose', err);
  }
};
