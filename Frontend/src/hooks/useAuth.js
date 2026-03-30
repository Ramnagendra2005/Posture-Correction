// src/hooks/useAuth.js
import { useContext } from "react";
import AuthContext from "../AuthContext";

// Custom hook for easy access to the AuthContext
export const useAuth = () => {
  return useContext(AuthContext);
};

export default useAuth;
