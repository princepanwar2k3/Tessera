import { useEffect, useReducer, useState } from "react";
import { emptyMeterState, reduceMeter } from "../lib/meter-state.js";
import { subscribeToJob } from "../lib/api.js";
import { Meter } from "./Meter.js";
import { Ticker } from "./Ticker.js";

/**
 * Screen 2: one job, watched live.
 *
 * Everything the renter controls is named for what it does: the meter, the
 * receipts, and the one decision available — whether to keep buying.
 */
export function JobView({ jobId }: { jobId: string }) {
  const [state, dispatch] = useReducer(reduceMeter, emptyMeterState);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setError(undefined);
    return subscribeToJob(jobId, dispatch, setError);
  }, [jobId]);

  return (
    <>
      <Meter state={state} />
      {error && <p className="error">{error}</p>}
      <Ticker lines={state.ticker} />
    </>
  );
}
