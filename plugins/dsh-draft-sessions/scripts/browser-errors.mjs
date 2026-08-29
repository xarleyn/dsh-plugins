const EXPECTED_HOST_OUTAGE_ERROR =
  /\bnet::ERR_(?:CONNECTION_(?:ABORTED|CLOSED|REFUSED|RESET)|INCOMPLETE_CHUNKED_ENCODING)\b|Connection closed before receiving a handshake response/;

export function isExpectedBrowserError(error) {
  return (
    (error.duringHostOutage &&
      EXPECTED_HOST_OUTAGE_ERROR.test(error.message)) ||
    error.message.includes("the server responded with a status of 404")
  );
}
