#include <iostream>
using namespace std;

int main() {
    int n;
    cout << "Enter number of processes: ";
    cin >> n;

    int pid[n], arrival[n], burst[n];
    int completion[n], turnaround[n], waiting[n];

    // Input process details
    for (int i = 0; i < n; i++) {
        pid[i] = i + 1;
        cout << "Process " << i + 1 << " - Arrival time: ";
        cin >> arrival[i];
        cout << "Process " << i + 1 << " - Burst time: ";
        cin >> burst[i];
    }

    // FCFS Scheduling
    int current_time = 0;
    for (int i = 0; i < n; i++) {
        if (current_time < arrival[i]) {
            current_time = arrival[i];
        }

        current_time += burst[i];
        completion[i] = current_time;
        turnaround[i] = completion[i] - arrival[i];
        waiting[i] = turnaround[i] - burst[i];
    }

    // Display results
    cout << "\n========== FCFS CPU SCHEDULING ==========" << endl;
    cout << "PID\tAT\tBT\tCT\tTAT\tWT" << endl;
    cout << "==========================================" << endl;

    float avg_waiting = 0, avg_turnaround = 0;

    for (int i = 0; i < n; i++) {
        cout << pid[i] << "\t" << arrival[i] << "\t"
             << burst[i] << "\t" << completion[i] << "\t"
             << turnaround[i] << "\t" << waiting[i] << endl;

        avg_waiting += waiting[i];
        avg_turnaround += turnaround[i];
    }

    cout << "==========================================" << endl;
    cout << "\nAverage Waiting Time: " << avg_waiting / n << endl;
    cout << "Average Turnaround Time: " << avg_turnaround / n << endl;

    return 0;
}
