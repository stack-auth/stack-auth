import { useState } from "react"

export function usePaymentsStep() {
  const [country, setCountry] = useState("US")
  const isUS = country === "US"

  return { country, setCountry, isUS }
}
