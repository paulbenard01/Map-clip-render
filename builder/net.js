/**
 * fetch + JSON.parse with an error message that names the problem.
 *
 * Going through `res.json()` directly means a 404 surfaces as
 * "unexpected character at line 1 column 1" — the parser choking on the
 * first letter of an error page. That says nothing about which file was
 * missing, which is the only thing you actually need to know.
 */
export async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not reach ${url} — is the builder's server still running?`);
  }

  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `${url} returned ${res.status} ${res.statusText}.\n\n` +
      (url.startsWith("/data/")
        ? "The basemap files are generated rather than stored in the repository.\n" +
          "Build them with:  npm run build-basemap\n" +
          "(The builder normally does this for you at startup.)"
        : `Server said: ${body.slice(0, 200)}`)
    );
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`${url} did not return valid JSON.\n\nIt started with: ${body.slice(0, 120)}`);
  }
}
