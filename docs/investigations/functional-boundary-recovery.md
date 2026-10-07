# Recover Functional boundary classification conflicts

The reported error (`Functional processing could not validate source row 848: A source boundary was incorrectly removed`) came from treating an AI internal-operation classification as fatal when source identity required a visible interaction. Repeated retries and subdivision could not guarantee that the model would change its classification.

Source identity now takes precedence for this specific conflict. A protected connection remains an interaction with its original source target, file and action. Its semantic kind is `unknown`; the source details, model rationale and correction flag are retained. No unsubstantiated control/feedback semantics are invented. Unknown connections cannot be collapsed by the consolidation pass. Other malformed responses, missing rows and provider errors retain their validation/error behavior.

The Functional view displays the number of corrected source connections and a Review connections button that opens their exact supporting rows. Correction flags survive save/reload, and the interaction description carries the review requirement into table copies and hazard inputs. The existing detailed CSU data is unchanged.

Verification: 17 suites / 119 tests passed, including reproduction with null targets and empty actions for internal classifications, complete evidence coverage, reload, hazard inputs, and the visible review/link flow. No customer source row or paid provider request was used; the screenshot establishes the failure path, not the contents of row 848. Production build and lint were also checked.
